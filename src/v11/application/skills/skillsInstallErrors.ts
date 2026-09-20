export class SkillsInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillsInstallError";
  }
}
