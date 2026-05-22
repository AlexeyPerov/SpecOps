import { revealItemInDir } from "@tauri-apps/plugin-opener";

export async function revealInFileManager(filePath: string): Promise<void> {
  await revealItemInDir(filePath);
}
