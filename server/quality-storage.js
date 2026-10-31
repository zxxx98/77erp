import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
const error = (message,status=400) => Object.assign(new Error(message),{status});
function clientFor(c) {
  return new S3Client({ region:'auto', endpoint:`https://${c.account_id}.r2.cloudflarestorage.com`, credentials:{accessKeyId:c.access_key,secretAccessKey:c.secret_key}, maxAttempts:2 });
}
export const qualityStorage = {
  async put(c,key,buffer) { const client=clientFor(c); try { await client.send(new PutObjectCommand({Bucket:c.bucket,Key:key,Body:buffer,ContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',IfNoneMatch:'*'}),{abortSignal:AbortSignal.timeout(60000)}); } finally {client.destroy();} },
  async get(c,key) { const client=clientFor(c); try { const r=await client.send(new GetObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:AbortSignal.timeout(60000)}); if(r.ContentLength>10485760) {r.Body.destroy();throw error('原文件大小无效。');} return Buffer.from(await r.Body.transformToByteArray()); } finally {client.destroy();} },
  async head(c,key) { const client=clientFor(c); try { await client.send(new HeadObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)}); } finally {client.destroy();} },
  async remove(c,key) { const client=clientFor(c); try { await client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)}); } finally {client.destroy();} },
};
