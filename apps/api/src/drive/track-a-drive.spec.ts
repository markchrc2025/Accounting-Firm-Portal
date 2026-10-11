/**
 * track-a-drive.spec.ts — U14 R1, R2 (hermetic): folder links, what a listed file
 * may not be, and reading the robot's key. Invented ids and keys only.
 */
import { generateKeyPairSync } from "node:crypto";
import { readRobotKey } from "./drive-key";
import { driveIdFromLink, folderLink } from "./drive-links";
import { listingProblem } from "./drive.service";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-012";

describe("U14 R2 · a folder link, however it is pasted", () => {
  it.each([
    [`https://drive.google.com/drive/folders/${ID}`],
    [`https://drive.google.com/drive/folders/${ID}?usp=sharing`],
    [`https://drive.google.com/drive/u/1/folders/${ID}?usp=drive_link`],
    [`drive.google.com/drive/folders/${ID}`],
    [`https://drive.google.com/open?id=${ID}`],
    [`  ${ID}  `],
    [`https://drive.google.com/file/d/${ID}/view?usp=sharing`],
    [`https://docs.google.com/document/d/${ID}/edit`],
  ])("%s gives the id", (link) => {
    expect(driveIdFromLink(link)).toBe(ID);
  });

  it.each([
    ["another site", `https://example.com/drive/folders/${ID}`],
    ["a Drive page with no id", "https://drive.google.com/drive/my-drive"],
    ["words", "the receipts folder"],
    ["too short to be an id", "abc"],
  ])("%s is not a folder link", (_l, link) => {
    expect(driveIdFromLink(link)).toBeNull();
  });

  it("the link the Portal shows is the plain folder link", () => {
    expect(folderLink(ID)).toBe(`https://drive.google.com/drive/folders/${ID}`);
  });
});

describe("U14 R2 · what a listed file cannot be", () => {
  const item = (mimeType: string, size: number | null = 1000) => ({
    id: "x",
    name: "x",
    mimeType,
    size,
    modifiedTime: "2026-09-01T00:00:00.000Z",
  });
  it.each([
    [
      "application/vnd.google-apps.document",
      null,
      "A Google Docs file, not a photo or PDF.",
    ],
    [
      "application/vnd.google-apps.spreadsheet",
      null,
      "A Google Sheets file, not a photo or PDF.",
    ],
    ["application/vnd.google-apps.shortcut", null, "A shortcut, not a photo or PDF."],
    ["video/quicktime", 5000, "A video, not a photo or PDF."],
    ["audio/mpeg", 5000, "An audio file, not a photo or PDF."],
    ["image/heic", 11 * 1024 * 1024, "Larger than 10 MB."],
    ["image/heic", 10 * 1024 * 1024, null],
    ["application/pdf", 2000, null],
    ["application/octet-stream", 2000, null],
  ])("%s (%s bytes) → %s", (mime, size, problem) => {
    expect(listingProblem(item(mime, size))).toBe(problem);
  });
});

describe("U14 R1 · reading the robot's key", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const key = {
    client_email: "robot@invented-project.iam.gserviceaccount.com",
    private_key: pem,
  };

  it("absent or blank: not set up, no problem", () => {
    expect(readRobotKey(undefined)).toBeNull();
    expect(readRobotKey("   ")).toBeNull();
  });

  it.each([
    ["not JSON", "hello"],
    ["no private key", JSON.stringify({ client_email: key.client_email })],
    ["no email", JSON.stringify({ private_key: pem })],
    [
      "a private key that is not one",
      JSON.stringify({
        ...key,
        private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
      }),
    ],
    [
      "an EC key, not RSA",
      JSON.stringify({
        ...key,
        private_key: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      }),
    ],
  ])("%s: the key could not be read", (_l, raw) => {
    expect(readRobotKey(raw)).toEqual({
      problem: "The key in GOOGLE_SERVICE_ACCOUNT_JSON could not be read.",
    });
  });

  it.each([
    ["as pasted", JSON.stringify(key, null, 2)],
    ["line breaks stripped", JSON.stringify(key, null, 2).replace(/\n/g, "")],
    [
      "the private key's \\n turned into real line breaks",
      JSON.stringify(key).replace(/\\n/g, "\n"),
    ],
    ["in double quotes", `"${JSON.stringify(key).replace(/"/g, '"')}"`],
    ["as base64", Buffer.from(JSON.stringify(key)).toString("base64")],
    [
      "as base64 wrapped at 76",
      Buffer.from(JSON.stringify(key))
        .toString("base64")
        .replace(/(.{76})/g, "$1\n"),
    ],
  ])("%s: read", (_l, raw) => {
    const read = readRobotKey(raw);
    expect(read && "key" in read ? read.key.clientEmail : read).toBe(key.client_email);
  });
});
