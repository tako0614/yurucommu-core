// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field
//
// Router entry: composes the current DM sub-modules.

import { Hono } from "hono";
import type { HonoEnv } from "./conversations-helpers.ts";

import contacts from "./contacts.ts";
import requests from "./requests.ts";
import typing from "./typing.ts";
import readArchive from "./read-archive.ts";

// -- Routes --

const dm = new Hono<HonoEnv>();

// Mount sub-routers
dm.route("/", contacts);
dm.route("/", requests);
dm.route("/", typing);
dm.route("/", readArchive);

export default dm;
