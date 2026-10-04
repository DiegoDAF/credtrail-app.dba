import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
assert(bucket);
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

try {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      break;
    } catch (error) {
      if (attempt === 30) throw error;
      await setTimeout(1000);
    }
  }
  const object = { Bucket: bucket, Key: "smoke/storage-contract.json" };
  const body = JSON.stringify({ message: "Credential storage smoke test" });
  await client.send(new PutObjectCommand({ ...object, Body: body, IfNoneMatch: "*" }));
  await assert.rejects(
    client.send(new PutObjectCommand({ ...object, Body: "overwrite", IfNoneMatch: "*" })),
    (error) => error.$metadata?.httpStatusCode === 412,
  );
  const result = await client.send(new GetObjectCommand(object));
  assert.equal(await result.Body.transformToString(), body);
  const metadata = await client.send(new HeadObjectCommand(object));
  assert.equal(metadata.ContentLength, Buffer.byteLength(body));
  await client.send(new DeleteObjectCommand(object));
  await assert.rejects(
    client.send(new HeadObjectCommand(object)),
    (error) => error.$metadata?.httpStatusCode === 404,
  );
} finally {
  client.destroy();
}
