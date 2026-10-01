import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TuiClipboardImage, TuiImageMediaType, TuiReadClipboardImage } from "@zcode/tui";

const DEFAULT_MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

type CommandResult = {
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  stdout: Buffer;
};

type CommandRunner = (
  file: string,
  args: string[],
  options: {
    maxBytes: number;
    signal?: AbortSignal;
  },
) => Promise<CommandResult>;

type NodeClipboardImageReaderOptions = {
  maxBytes?: number;
  platform?: NodeJS.Platform;
  processEnv?: NodeJS.ProcessEnv;
  runCommand?: CommandRunner;
  tempDirectory?: string;
};

function resolveDefaultClipboardDirectory(processEnv: NodeJS.ProcessEnv = process.env): string {
  const storageRoot = processEnv.ZCODE_STORAGE_DIR?.trim() || join(homedir(), ".zcodium");
  return join(storageRoot, "clipboard");
}

export function createNodeClipboardImageReader(
  options: NodeClipboardImageReaderOptions = {},
): TuiReadClipboardImage {
  const platform = options.platform ?? process.platform;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CLIPBOARD_IMAGE_BYTES;
  const runCommand = options.runCommand ?? runCommandBuffer;
  const tempDirectory =
    options.tempDirectory ?? resolveDefaultClipboardDirectory(options.processEnv);

  return async (readOptions = {}) => {
    if (platform === "darwin") {
      return await readMacClipboardImage({
        maxBytes,
        runCommand,
        signal: readOptions.abortSignal,
        tempDirectory,
      });
    }
    if (platform === "linux") {
      return await readLinuxClipboardImage({
        maxBytes,
        runCommand,
        signal: readOptions.abortSignal,
      });
    }
    if (platform === "win32") {
      return await readWindowsClipboardImage({
        maxBytes,
        runCommand,
        signal: readOptions.abortSignal,
        tempDirectory,
      });
    }
    return null;
  };
}

async function readMacClipboardImage(options: {
  maxBytes: number;
  runCommand: CommandRunner;
  signal?: AbortSignal;
  tempDirectory: string;
}): Promise<TuiClipboardImage | null> {
  await mkdir(options.tempDirectory, { recursive: true });
  const directory = await mkdtemp(join(options.tempDirectory, "zcode-clipboard-"));
  const imagePath = join(directory, "clipboard.png");

  try {
    const result = await options.runCommand(
      "osascript",
      [
        "-e",
        "set png_data to (the clipboard as «class PNGf»)",
        "-e",
        `set fp to open for access POSIX file ${appleScriptString(imagePath)} with write permission`,
        "-e",
        "write png_data to fp",
        "-e",
        "close access fp",
      ],
      { maxBytes: options.maxBytes, signal: options.signal },
    );
    if (result.exitCode !== 0) return null;
    return await readImageFile(imagePath, "image/png", options.maxBytes);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function readLinuxClipboardImage(options: {
  maxBytes: number;
  runCommand: CommandRunner;
  signal?: AbortSignal;
}): Promise<TuiClipboardImage | null> {
  const commands: Array<{ args: string[]; file: string; mediaType: TuiImageMediaType }> = [
    { args: ["--type", "image/png"], file: "wl-paste", mediaType: "image/png" },
    { args: ["--type", "image/jpeg"], file: "wl-paste", mediaType: "image/jpeg" },
    { args: ["--type", "image/gif"], file: "wl-paste", mediaType: "image/gif" },
    { args: ["--type", "image/webp"], file: "wl-paste", mediaType: "image/webp" },
    {
      args: ["-selection", "clipboard", "-t", "image/png", "-o"],
      file: "xclip",
      mediaType: "image/png",
    },
    {
      args: ["-selection", "clipboard", "-t", "image/jpeg", "-o"],
      file: "xclip",
      mediaType: "image/jpeg",
    },
    {
      args: ["-selection", "clipboard", "-t", "image/gif", "-o"],
      file: "xclip",
      mediaType: "image/gif",
    },
    {
      args: ["-selection", "clipboard", "-t", "image/webp", "-o"],
      file: "xclip",
      mediaType: "image/webp",
    },
  ];

  for (const command of commands) {
    const result = await options.runCommand(command.file, command.args, {
      maxBytes: options.maxBytes,
      signal: options.signal,
    });
    const image = bufferToClipboardImage(result.stdout, command.mediaType, options.maxBytes);
    if (result.exitCode === 0 && image) return image;
  }

  return null;
}

async function readWindowsClipboardImage(options: {
  maxBytes: number;
  runCommand: CommandRunner;
  signal?: AbortSignal;
  tempDirectory: string;
}): Promise<TuiClipboardImage | null> {
  await mkdir(options.tempDirectory, { recursive: true });
  const directory = await mkdtemp(join(options.tempDirectory, "zcode-clipboard-"));
  const imagePath = join(directory, "clipboard.png");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$img = Get-Clipboard -Format Image;",
    "if ($null -eq $img) { exit 2 }",
    `$img.Save(${powershellString(imagePath)}, [System.Drawing.Imaging.ImageFormat]::Png);`,
  ].join(" ");

  try {
    const result = await options.runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { maxBytes: options.maxBytes, signal: options.signal },
    );
    if (result.exitCode !== 0) return null;
    return await readImageFile(imagePath, "image/png", options.maxBytes);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function readImageFile(
  path: string,
  mediaType: TuiImageMediaType,
  maxBytes: number,
): Promise<TuiClipboardImage | null> {
  const buffer = await readFile(path);
  return bufferToClipboardImage(buffer, mediaType, maxBytes);
}

function bufferToClipboardImage(
  buffer: Buffer,
  mediaType: TuiImageMediaType,
  maxBytes: number,
): TuiClipboardImage | null {
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;
  return {
    dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
    mediaType,
    sizeBytes: buffer.byteLength,
  };
}

async function runCommandBuffer(
  file: string,
  args: string[],
  options: {
    maxBytes: number;
    signal?: AbortSignal;
  },
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        signal: options.signal,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve({ exitCode: -1, stdout: Buffer.alloc(0) });
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > options.maxBytes) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => finish({ exitCode: -1, stdout: Buffer.alloc(0) }));
    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        stdout: Buffer.concat(chunks),
      });
    });
  });
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function powershellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
