export interface WorkExperience {
  company: string
  title: string
  period: string // "2022.4 - 2024.3" or "2024.5 - 至今"
  source: 'pdf' | 'manual'
}

export interface PullRequest {
  title: string
  body: string
  mergedAt: string
  filesChanged: string[]
}

export interface RepoData {
  name: string
  org: string
  company: string
  period: string
  techStack: string[]
  prs: PullRequest[]
}

export interface UserProfile {
  name: string
  phone: string
  email: string
  github?: string
}

export interface Cache {
  fetchedAt: string
  username: string
  role: string
  jd: string | null
  targetPosition: string | null
  profile: UserProfile
  existingExperience: WorkExperience[]
  education: string
  repos: RepoData[]
}

export type RoleKey =
  | 'go' | 'java' | 'node' | 'frontend'
  | 'ios' | 'android' | 'fullstack' | 'architect' | 'ai'
