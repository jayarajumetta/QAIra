import type { AiDesignImageInput, AiDesignedTestCaseCandidate } from "../types";

export const parseExternalLinks = (value: string) =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image for compression."));
    image.src = url;
  });

const compressImageDataUrl = async (dataUrl: string, maxEdge = 720, quality = 0.35) => {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
};

export const readImageFiles = async (files: FileList | null) => {
  const collection = Array.from(files || []);
  const images = await Promise.all(
    collection.map(async (file) => ({
      name: file.name,
      url: await compressImageDataUrl(await readFileAsDataUrl(file))
    }))
  );

  return images.filter((image) => image.url) as AiDesignImageInput[];
};

export const appendUniqueImages = (current: AiDesignImageInput[], incoming: AiDesignImageInput[]) => {
  const byUrl = new Map(current.map((image) => [image.url, image]));

  incoming.forEach((image) => {
    byUrl.set(image.url, image);
  });

  return Array.from(byUrl.values());
};

export const toggleRequirementOnPreviewCase = (
  cases: AiDesignedTestCaseCandidate[],
  clientId: string,
  requirementId: string,
  requirementTitle: string
) =>
  cases.map((candidate) => {
    if (candidate.client_id !== clientId) {
      return candidate;
    }

    const hasRequirement = candidate.requirement_ids.includes(requirementId);
    const requirement_ids = hasRequirement
      ? candidate.requirement_ids.filter((id) => id !== requirementId)
      : [...candidate.requirement_ids, requirementId];
    const requirement_titles = hasRequirement
      ? candidate.requirement_titles.filter((title) => title !== requirementTitle)
      : [...candidate.requirement_titles, requirementTitle];

    return {
      ...candidate,
      requirement_ids,
      requirement_titles
    };
  });
