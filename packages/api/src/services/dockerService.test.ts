import { describe, test, expect, afterEach } from "bun:test";
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
