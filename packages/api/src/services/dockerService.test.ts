import { afterEach, describe, expect, test } from "bun:test";
import { buildDockerArgs } from "./dockerService";

describe("buildDockerArgs", () => {
  afterEach(() => {
    delete process.env.DOCKER_APPROVE_CMD;
  });

  test("returns null when DOCKER_APPROVE_CMD not set", () => {
    delete process.env.DOCKER_APPROVE_CMD;
    expect(buildDockerArgs()).toBeNull();
  });

  test("returns split command array", () => {
    process.env.DOCKER_APPROVE_CMD = "docker exec mycontainer echo hello";
    const args = buildDockerArgs();
    expect(args).toEqual(["docker", "exec", "mycontainer", "echo", "hello"]);
  });
});

describe("buildDockerArgs with {{container}}", () => {
  test("replaces {{container}} placeholder with container name", () => {
    process.env.DOCKER_APPROVE_CMD = "docker exec {{container}} curl http://localhost/approve";
    const args = buildDockerArgs("my-container");
    expect(args).toEqual(["docker", "exec", "my-container", "curl", "http://localhost/approve"]);
  });

  test("leaves cmd unchanged when no containerName provided", () => {
    process.env.DOCKER_APPROVE_CMD = "docker exec openclaw curl http://x/approve";
    const args = buildDockerArgs();
    expect(args).toEqual(["docker", "exec", "openclaw", "curl", "http://x/approve"]);
  });
});
