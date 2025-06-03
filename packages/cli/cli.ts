#!/usr/bin/env deno run --allow-all

/**
 * Takopack CLI 3.0
 * 
 * Thin wrapper around @takopack/builder
 * Deno/npm両対応のCLI実行環境
 */

import { createCLI } from "../builder/mod.ts";

const cli = createCLI();
await cli.run();
