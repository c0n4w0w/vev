import { account } from "./account";
import { channels } from "./channels";
import { admin } from "./admin";
import { collaboration } from "./collaboration";
import { common } from "./common";
import { community } from "./community";
import { errors } from "./errors";
import { portal } from "./portal";
import { shell } from "./shell";
import { workspace } from "./workspace";

/**
 * Norwegian Bokmål — the source dictionary.
 *
 * The keys defined here *are* the message keys; `en` is typed against them, so
 * a message missing from any other language is a type error rather than a
 * blank on screen.
 */
export const nb = { ...common, ...shell, ...community, ...admin, ...errors, ...portal, ...account, ...collaboration, ...workspace, ...channels } as const;

export type MessageKey = keyof typeof nb;
