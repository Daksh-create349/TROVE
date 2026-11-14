import type { AppProfile } from "@shared/types";
import type { ProfileRepository } from "../database/repositories/profileRepository";

export class ProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  getProfile(): AppProfile | null {
    return this.profiles.get();
  }

  saveProfile(displayName: string): {
    profile: AppProfile;
    created: boolean;
  } {
    return this.profiles.upsert(displayName.trim());
  }
}
