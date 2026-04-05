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

export const readImageFiles = async (files: FileList | null) => {
  const collection = Array.from(files || []);
  const images = await Promise.all(
    collection.map(async (file) => ({
      name: file.name,
      url: await readFileAsDataUrl(file)
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
