import { ContentDefinition } from "../../../../../shared/contracts";
import { getContentDefinition } from "../../tasks/catalogService";

export function resolveContentDefinition(contentId: string, stored?: ContentDefinition): ContentDefinition {
  if (stored) return stored;
  return getContentDefinition(contentId);
}
