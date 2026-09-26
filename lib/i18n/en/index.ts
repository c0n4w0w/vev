import type { MessageKey } from "../nb";
import { admin } from "./admin";
import { collaboration } from "./collaboration";
import { common } from "./common";
import { community } from "./community";
import { errors } from "./errors";
import { portal } from "./portal";
import { shell } from "./shell";

/** English. Every key of the Norwegian source dictionary, and nothing else. */
export const en: Record<MessageKey, string> = {
  ...common,
  ...shell,
  ...community,
  ...admin,
  ...errors,
  ...portal,
  ...collaboration,
};
