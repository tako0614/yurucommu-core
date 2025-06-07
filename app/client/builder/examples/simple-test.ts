#!/usr/bin/env deno run --allow-all

/**
 * 新しいAPIの簡単なテスト
 */

import FunctionBasedTakopack from "../main.ts";

import { z } from "npm:zod";

console.log("🧪 簡単なAPIテスト開始...");

const builder = new FunctionBasedTakopack()
  .package("simple-test")
  .output("dist")
  .config({
    name: "シンプルテスト",
    description: "新しいAPIの基本テスト",
    version: "1.0.0",
    identifier: "test.simple",
    permissions: ["kv:read", "kv:write"],
  })
  .serverFunction("hello", (name: string) => {
    const schema = z.string().min(1);
    try {
      schema.parse(name);
      return `Hello, ${name}!`;
    } catch (error) {
      console.error("Validation failed:", error);
      return `Invalid input: ${name}`;
    }
  })
  .addClientToServerEvent("ping", (data: { message: string }) => {
    console.log("Ping received:", data.message);
    return [200, { response: "pong" }];
  })
  .ui(`
    <h1>Simple Test Extension</h1>
    <p>This is a basic test of the new API.</p>
  `)
  .activityPub({
    context: "https://www.w3.org/ns/activitystreams",
    object: "Note",
    priority: 100,
    serial: true,
  }, (activity) => {
    return !!activity;
  }, (activity) => {
    console.log("Received Activity:", activity);
    return activity;
  })
  .clientFunction("greet", (name: string) => {
    console.log(`Hello from the client, ${name}!`);
  });

await builder.build();

console.log("✅ 簡単なテストが完了しました！");
