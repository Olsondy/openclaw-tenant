import { describe, test, expect } from "bun:test";
import { buildDockerArgs } from "./dockerService";

describe("buildDockerArgs", () => {
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
