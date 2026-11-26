import { mkdir } from "node:fs/promises";
/**
 * Helper: save uploaded file to disk
 * Returns the saved file metadata
 */
export async function saveFile(
  file: File,
  uploadDir: string = "./uploads",
): Promise<{
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}> {
  await mkdir(uploadDir, { recursive: true });

  const ext = file.name.includes(".")
    ? file.name
        .split(".")
        .pop()!
        .replace(/[^a-zA-Z0-9]/g, "") || "bin"
    : "bin";
  const baseName = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${crypto.randomUUID()}-${baseName.slice(0, 100)}.${ext.slice(0, 16)}`;
  const filePath = `${uploadDir}/${fileName}`;

  try {
    await Bun.write(filePath, file);
  } catch (error) {
    await Bun.file(filePath)
      .delete()
      .catch(() => {});
    throw error;
  }

  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    try {
      const preview = await new Bun.Image(file, { maxPixels: 16_777_216 })
        .resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .blob();
      // Small images are already cheaper to serve as originals.
      if (preview.size < file.size)
        await Bun.write(`${filePath}.preview.webp`, preview);
    } catch (error) {
      // Unsupported or oversized images still retain their original upload.
      await Bun.file(`${filePath}.preview.webp`)
        .delete()
        .catch(() => {});
      console.warn("Attachment preview unavailable:", fileName, error);
    }
  }

  return { fileName, filePath, fileSize: file.size, mimeType: file.type };
}

export async function deleteFile(filePath: string) {
  for (const path of [filePath, `${filePath}.preview.webp`]) {
    try {
      await Bun.file(path).delete();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
