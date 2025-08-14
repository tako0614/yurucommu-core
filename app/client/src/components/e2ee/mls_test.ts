function assert(condition: boolean, message?: string): void {
  if (!condition) throw new Error(message ?? "assertion failed");
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `assertion failed: ${actual} !== ${expected}`);
  }
}
import {
  createCommitAndWelcomes,
  decryptMessage,
  encryptMessageWithAck,
  generateKeyPackage,
  verifyKeyPackage,
} from "./mls_core.ts";
import { fetchKeyPackages } from "./api.ts";
import {
  joinWithWelcome,
  verifyWelcome,
} from "../../../../shared/mls_wrapper.ts";

// サーバー側の KeyPackage 選択ロジックをテスト用に簡易実装
interface KeyPackageDoc {
  _id: unknown;
  content: string;
  mediaType: string;
  encoding: string;
  createdAt: string;
  version: string;
  cipherSuite: number;
  generator: string;
  used?: boolean;
}

function selectKeyPackages(
  list: KeyPackageDoc[],
  suite: number,
  M = 3,
): KeyPackageDoc[] {
  return list
    .filter((kp) =>
      kp.version === "1.0" && kp.cipherSuite === suite && kp.used !== true
    )
    .sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return db - da;
    })
    .reduce((acc: KeyPackageDoc[], kp) => {
      if (kp.generator && acc.some((v) => v.generator === kp.generator)) {
        return acc;
      }
      acc.push(kp);
      return acc;
    }, [])
    .slice(0, M);
}

Deno.test("ts-mlsでCommitとWelcomeを生成できる", async () => {
  const bob = await generateKeyPackage("bob");
  assert(await verifyKeyPackage(bob.encoded, "bob"));
  const { commit, welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: bob.encoded, actor: "bob" },
  ]);
  assert(commit instanceof Uint8Array);
  assertEquals(welcomes.length, 1);
});

Deno.test("KeyPackage取得とCommit/Welcome交換ができる", async () => {
  const kp1 = await generateKeyPackage("alice1");
  const kp2 = await generateKeyPackage("alice2");
  const list: KeyPackageDoc[] = [
    {
      _id: 1,
      content: kp1.encoded,
      mediaType: "application/mls+json",
      encoding: "base64",
      createdAt: "2023-01-01T00:00:00.000Z",
      version: "1.0",
      cipherSuite: 1,
      generator: "g1",
    },
    {
      _id: 2,
      content: kp2.encoded,
      mediaType: "application/mls+json",
      encoding: "base64",
      createdAt: "2023-01-02T00:00:00.000Z",
      version: "1.0",
      cipherSuite: 1,
      generator: "g2",
    },
  ];
  const selected = selectKeyPackages(list, 1, 1);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          items: selected.map((kp) => ({
            id: String(kp._id),
            type: "KeyPackage",
            content: kp.content,
            mediaType: kp.mediaType,
            encoding: kp.encoding,
            createdAt: kp.createdAt,
          })),
        }),
        { status: 200 },
      ),
    );
  const fetched = await fetchKeyPackages("alice");
  assertEquals(fetched.length, 1);
  globalThis.fetch = originalFetch;

  const { welcomes, state: serverState } = await createCommitAndWelcomes(
    1,
    ["alice"],
    [{ content: fetched[0].content, actor: "alice" }],
  );
  assertEquals(welcomes.length, 1);
  const welcome = welcomes[0].data;
  assert(await verifyWelcome(welcome));
  const aliceState = await joinWithWelcome(welcome, kp2);
  assert(aliceState);
  assert(serverState);
});

Deno.test("Ackが一度だけ送信される", async () => {
  const bob = await generateKeyPackage("bob");
  const { welcomes, state: serverState0 } = await createCommitAndWelcomes(
    1,
    ["bob"],
    [{ content: bob.encoded, actor: "bob" }],
  );
  const welcome = welcomes[0].data;
  const clientState0 = await joinWithWelcome(welcome, bob);
  let serverState = serverState0;
  let clientState = clientState0;

  const { messages, state: clientState1 } = await encryptMessageWithAck(
    clientState,
    "こんにちは",
    "room1",
    "device1",
  );
  clientState = clientState1;
  assertEquals(messages.length, 2);
  const resAck = await decryptMessage(serverState, messages[0]);
  assert(resAck);
  serverState = resAck.state;
  const ackJson = JSON.parse(new TextDecoder().decode(resAck.plaintext));
  assertEquals(ackJson.type, "joinAck");
  const resMsg = await decryptMessage(serverState, messages[1]);
  assert(resMsg);
  serverState = resMsg.state;
  assertEquals(new TextDecoder().decode(resMsg.plaintext), "こんにちは");

  const { messages: msgs2 } = await encryptMessageWithAck(
    clientState,
    "2回目",
    "room1",
    "device1",
  );
  assertEquals(msgs2.length, 1);
  const res2 = await decryptMessage(serverState, msgs2[0]);
  assert(res2);
  assertEquals(new TextDecoder().decode(res2.plaintext), "2回目");
});
