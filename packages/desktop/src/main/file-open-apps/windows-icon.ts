import { win32 } from "node:path";
import type { NativeFileApplication } from "./contract.js";

// 用系统 AppID 识别共享套件，不依据显示名称或文件扩展名猜测应用。
export const WPS_SUITE_APP_ID = "Kingsoft.Office.KPrometheus";

/** Windows 关联图标在原生查询进程内批量读取，不另起每图进程。 */
export const WINDOWS_ASSOCIATION_ICON_SOURCE = String.raw`
public static class WindowsAssociationIcon {
  const int IconSize = 48;
  [DllImport("shell32.dll", EntryPoint = "SHDefExtractIconW", CharSet = CharSet.Unicode)]
  static extern int SHDefExtractIcon(string file, int index, uint flags, out IntPtr large, out IntPtr small, uint size);
  [DllImport("shlwapi.dll", EntryPoint = "SHLoadIndirectString", CharSet = CharSet.Unicode)]
  static extern int SHLoadIndirectString(string source, StringBuilder output, uint length, IntPtr reserved);
  [DllImport("user32.dll")]
  static extern bool DestroyIcon(IntPtr icon);

  static string Encode(System.Drawing.Image image) {
    using (var output = new MemoryStream()) {
      image.Save(output, System.Drawing.Imaging.ImageFormat.Png);
      if (output.Length > 65536) return null;
      return "data:image/png;base64," + Convert.ToBase64String(output.ToArray());
    }
  }

  static string ReadResource(string path, int index) {
    IntPtr large = IntPtr.Zero, small = IntPtr.Zero;
    try {
      int result = SHDefExtractIcon(path, index, 0, out large, out small, IconSize | (16u << 16));
      if (result != 0 || large == IntPtr.Zero) return null;
      // FromHandle 不接管原始 HICON；只释放克隆，原始大小图标在 finally 各释放一次。
      using (var icon = (System.Drawing.Icon)System.Drawing.Icon.FromHandle(large).Clone())
      using (var bitmap = icon.ToBitmap()) return Encode(bitmap);
    } finally {
      if (large != IntPtr.Zero) DestroyIcon(large);
      if (small != IntPtr.Zero && small != large) DestroyIcon(small);
    }
  }

  public static string Read(string rawPath, int index) {
    try {
      if (String.IsNullOrWhiteSpace(rawPath)) return null;
      string path = rawPath.Trim();
      // package/ms-resource 是间接资源，不是磁盘路径；先让系统解析，再检查真实图片。
      if (path.StartsWith("@", StringComparison.Ordinal)) {
        var resolved = new StringBuilder(32768);
        if (SHLoadIndirectString(path, resolved, (uint)resolved.Capacity, IntPtr.Zero) != 0) return null;
        path = resolved.ToString();
      }
      path = Environment.ExpandEnvironmentVariables(path);
      // 图标仅访问系统返回的本机固定盘路径，不把 URI、UNC 或设备路径当普通文件读取。
      if (path.Length < 3 || !Char.IsLetter(path[0]) || path[1] != ':' || (path[2] != '\\' && path[2] != '/')) return null;
      if (!File.Exists(path)) return null;
      string extension = Path.GetExtension(path).ToLowerInvariant();
      if (extension == ".exe" || extension == ".dll" || extension == ".icl" || extension == ".ico") return ReadResource(path, index);
      if (new FileInfo(path).Length > 8 * 1024 * 1024) return null;
      using (var source = System.Drawing.Image.FromFile(path)) {
        if (source.Width < 1 || source.Height < 1 || source.Width > 1024 || source.Height > 1024) return null;
        using (var bitmap = new System.Drawing.Bitmap(IconSize, IconSize, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
          using (var graphics = System.Drawing.Graphics.FromImage(bitmap)) {
            graphics.Clear(System.Drawing.Color.Transparent);
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            double scale = Math.Min((double)IconSize / source.Width, (double)IconSize / source.Height);
            int width = Math.Max(1, (int)Math.Round(source.Width * scale));
            int height = Math.Max(1, (int)Math.Round(source.Height * scale));
            graphics.DrawImage(source, (IconSize - width) / 2, (IconSize - height) / 2, width, height);
          }
          return Encode(bitmap);
        }
      }
    } catch { return null; }
  }
}
`;

/** 子进程输出仍需限制大小和 PNG 结构，不能把任意注册资源直接透传给 renderer。 */
export function normalizeWindowsIconDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 90_000) return null;
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) return null;
  const encoded = value.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 45 || bytes.length > 65536 || bytes.toString("base64") !== encoded)
    return null;
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 256 || height > 256) return null;
  if (
    bytes.readUInt32BE(bytes.length - 12) !== 0 ||
    bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND"
  )
    return null;
  return value;
}

/** 共享 launcher 的 Writer 图标不等于套件图标；suite/handler/launch identity 分开保留。 */
export function resolveWindowsAssociationIcon(application: NativeFileApplication): {
  iconDataUrl: string | null;
  iconIdentity: string | null;
} {
  if (application.appId?.toLowerCase() === WPS_SUITE_APP_ID.toLowerCase()) {
    const path = application.suiteIconPath?.trim() ?? "";
    const localTarget =
      /^[A-Za-z]:[\\/]/.test(path) && win32.isAbsolute(path) && !path.includes("\0");
    return {
      iconDataUrl: localTarget ? normalizeWindowsIconDataUrl(application.suiteIconDataUrl) : null,
      iconIdentity: localTarget ? `${path},0` : null,
    };
  }
  return {
    iconDataUrl:
      application.iconLocationHresult === undefined || application.iconLocationHresult === 0
        ? normalizeWindowsIconDataUrl(application.iconDataUrl)
        : null,
    iconIdentity: application.iconPath
      ? `${application.iconPath},${application.iconIndex ?? 0}`
      : null,
  };
}

/** 只按系统 AppID 定位真实套件入口；同一查询内只解析和提取一次。 */
export const WINDOWS_SUITE_ICON_SCRIPT = `
$suiteId = ${JSON.stringify(WPS_SUITE_APP_ID)}
$suiteRows = @($zcodeQuery.applications | Where-Object { $_.appId -ieq $suiteId })
if (($env:ZCODE_FILE_APP_INCLUDE_ICONS -ne '0') -and $suiteRows.Count -gt 0) {
  $suiteShell = $null; $suiteFolder = $null; $suiteItem = $null
  try {
    $suiteShell = New-Object -ComObject Shell.Application
    $suiteFolder = $suiteShell.NameSpace('shell:AppsFolder')
    $suiteItem = $suiteFolder.ParseName($suiteId)
    if ($suiteItem -and $suiteItem.ExtendedProperty('System.AppUserModel.ID') -ieq $suiteId) {
      $suiteTarget = [string]$suiteItem.ExtendedProperty('System.Link.TargetParsingPath')
      $suiteIcon = [WindowsAssociationIcon]::Read($suiteTarget, 0)
      foreach ($suiteRow in $suiteRows) {
        $suiteRow.suiteIconPath = $suiteTarget
        $suiteRow.suiteIconDataUrl = $suiteIcon
      }
    }
  } catch { }
  finally {
    foreach ($suiteObject in @($suiteItem, $suiteFolder, $suiteShell)) {
      if ($suiteObject -and [Runtime.InteropServices.Marshal]::IsComObject($suiteObject)) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($suiteObject)
      }
    }
  }
}
`;
