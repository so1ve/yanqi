import { defineEventHandler } from "h3";

import { queryParam } from "../utils/http";

export default defineEventHandler((event) =>
  event.context.logs.read(Number(queryParam(event, "after")) || 0),
);
