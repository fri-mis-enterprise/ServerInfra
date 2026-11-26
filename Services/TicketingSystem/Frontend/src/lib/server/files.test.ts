import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteFile, saveFile } from "./files";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

async function uploadDir() {
  const dir = await mkdtemp(join(tmpdir(), "ticketing-upload-"));
  dirs.push(dir);
  return join(dir, "nested");
}

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("preserves the original and creates a smaller WebP preview without stretching", async () => {
  const source = await new Bun.Image(pixel)
    .resize(1200, 800)
    .png({ compressionLevel: 0 })
    .blob();
  const file = new File([source], "screenshot.png", { type: "image/png" });
  const saved = await saveFile(file, await uploadDir());
  expect(await Bun.file(saved.filePath).bytes()).toEqual(await file.bytes());
  expect(saved.fileSize).toBe(file.size);
  const preview = Bun.file(`${saved.filePath}.preview.webp`);
  expect(preview.size).toBeLessThan(file.size);
  expect(await new Bun.Image(preview).metadata()).toMatchObject({
    width: 480,
    height: 320,
    format: "webp",
  });
  await deleteFile(saved.filePath);
  expect(await Bun.file(saved.filePath).exists()).toBe(false);
  expect(await Bun.file(`${saved.filePath}.preview.webp`).exists()).toBe(false);
  await expect(deleteFile(saved.filePath)).resolves.toBeUndefined();
});

test("leaves small images at their original size", async () => {
  const saved = await saveFile(
    new File([pixel], "pixel.png", { type: "image/png" }),
    await uploadDir(),
  );
  const preview = Bun.file(`${saved.filePath}.preview.webp`);
  if (await preview.exists()) {
    expect(await new Bun.Image(preview).metadata()).toMatchObject({
      width: 1,
      height: 1,
    });
  }
  expect(await Bun.file(saved.filePath).bytes()).toEqual(new Uint8Array(pixel));
});

test("keeps documents unchanged and sanitizes filenames", async () => {
  const saved = await saveFile(
    new File(["original document"], "../../report.p/d\\f", {
      type: "application/pdf",
    }),
    await uploadDir(),
  );
  expect(saved.fileName).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  expect(await Bun.file(saved.filePath).text()).toBe("original document");
  expect(await Bun.file(`${saved.filePath}.preview.webp`).exists()).toBe(false);
});

test("invalid and over-limit images keep their originals without a preview", async () => {
  const oversized = Buffer.from(pixel);
  oversized.writeUInt32BE(100_000, 16);
  oversized.writeUInt32BE(100_000, 20);
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const source of [Buffer.from("invalid image"), oversized]) {
      const saved = await saveFile(
        new File([source], "image.png", { type: "image/png" }),
        await uploadDir(),
      );
      expect(await Bun.file(saved.filePath).bytes()).toEqual(
        new Uint8Array(source),
      );
      expect(await Bun.file(`${saved.filePath}.preview.webp`).exists()).toBe(
        false,
      );
    }
    expect(warning).toHaveBeenCalledTimes(2);
  } finally {
    warning.mockRestore();
  }
});

test("reports filesystem errors when deleting attachments", async () => {
  const dir = await uploadDir();
  const saved = await saveFile(new File(["test"], "file.txt"), dir);
  await expect(deleteFile(dir)).rejects.toBeDefined();
  expect(await Bun.file(saved.filePath).text()).toBe("test");
});
