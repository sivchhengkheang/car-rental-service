import crypto from "crypto";

export function encryptPayload(payload) {
  const sk = process.env.BARAY_SK;
  const iv = process.env.BARAY_IV;

  if (!sk || !iv) {
    throw new Error("BARAY_SK and BARAY_IV environment variables are required");
  }

  const key = Buffer.from(sk, "base64");
  const ivBuffer = Buffer.from(iv, "base64");
  const plaintext = JSON.stringify(payload);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, ivBuffer);
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return encrypted.toString("base64");
}

export function decryptOrderId(encryptedOrderId) {
  const sk = process.env.BARAY_SK;
  const iv = process.env.BARAY_IV;

  if (!sk || !iv) {
    throw new Error("BARAY_SK and BARAY_IV environment variables are required");
  }

  const key = Buffer.from(sk, "base64");
  const ivBuffer = Buffer.from(iv, "base64");
  const encryptedData = Buffer.from(encryptedOrderId, "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);
  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}
