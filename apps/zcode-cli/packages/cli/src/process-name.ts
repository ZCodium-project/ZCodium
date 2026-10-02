export const CLI_COMMAND_NAME = "zcodium";
export const CLI_PROCESS_NAME = "zcode-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
