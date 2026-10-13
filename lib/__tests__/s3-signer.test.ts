import { describe, it, expect } from "vitest";
import { signS3Request, sha256Hex, awsEncode } from "../storage/s3-signer";

// Example credentials and requests from AWS's documentation, "Signature Calculations for the Authorization Header":
// the signatures below are the ones AWS publishes, so a match proves the implementation is a correct SigV4 signer.
const ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const NOW = new Date("2013-05-24T00:00:00Z");

describe("signS3Request (AWS Signature Version 4)", () => {
  it("reproduces AWS's documented signature for GET Object with a Range header", () => {
    const signed = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payload: "",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: "us-east-1",
      now: NOW,
    });
    expect(signed.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(signed.headers.authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
    expect(signed.headers.authorization).toContain(`Credential=${ACCESS_KEY_ID}/20130524/us-east-1/s3/aws4_request`);
  });

  it("reproduces AWS's documented signature for PUT Object (special character in the key, extra signed headers)", () => {
    const signed = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payload: "Welcome to Amazon S3.",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: "us-east-1",
      now: NOW,
    });
    expect(signed.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
    expect(signed.headers["x-amz-content-sha256"]).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
    );
  });

  it("requests the same percent-encoded path that it signed", () => {
    const signed = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      payload: "x",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: "us-east-1",
      now: NOW,
    });
    expect(signed.url).toBe("https://examplebucket.s3.amazonaws.com/test%24file.text");
  });

  it("never returns a host header (the HTTP client derives it from the URL)", () => {
    const signed = signS3Request({
      method: "GET",
      url: new URL("https://s3.example.com:9000/bucket/key.pdf"),
      payload: "",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: "auto",
      now: NOW,
    });
    expect("host" in signed.headers).toBe(false);
    expect(signed.headers.authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
  });
});

describe("helpers", () => {
  it("sha256Hex of the empty string is the well-known constant", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("awsEncode escapes everything except unreserved characters", () => {
    expect(awsEncode("a b/c$d!e'f(g)h*i~j-k_l.m")).toBe("a%20b%2Fc%24d%21e%27f%28g%29h%2Ai~j-k_l.m");
  });
});
