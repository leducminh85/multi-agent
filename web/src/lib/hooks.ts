import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import type {
  Activity,
  Agent,
  AgentDetail,
  Alert,
  Approval,
  Knowledge,
  Message,
  Mission,
  Project,
  Provider,
  ProviderDescriptor,
  Role,
  Settings,
  StoredFile,
  Task,
  TaskDetail,
} from './types';
import { useToast } from '../components/ui';

export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => get<Agent[]>('/agents') });
export const useAgent = (id: string | null) =>
  useQuery({ queryKey: ['agent', id], queryFn: () => get<AgentDetail & { activityLog: any[] }>(`/agents/${id}`), enabled: !!id });
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/roles') });
export const useProviders = () => useQuery({ queryKey: ['providers'], queryFn: () => get<Provider[]>('/providers') });
export const useProviderTypes = () => useQuery({ queryKey: ['provider-types'], queryFn: () => get<ProviderDescriptor[]>('/provider-types'), staleTime: Infinity });
export const useTasks = (params: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ['tasks', qs], queryFn: () => get<Task[]>(`/tasks${qs ? `?${qs}` : ''}`) });
};
export const useTask = (id: string | null) => useQuery({ queryKey: ['task', id], queryFn: () => get<TaskDetail>(`/tasks/${id}`), enabled: !!id });
export const useMissions = (projectId?: string) =>
  useQuery({ queryKey: ['missions', projectId ?? ''], queryFn: () => get<Mission[]>(`/missions${projectId ? `?projectId=${projectId}` : ''}`) });
export const useMission = (id: string | null) => useQuery({ queryKey: ['mission', id], queryFn: () => get<Mission>(`/missions/${id}`), enabled: !!id });
export const useMessages = (channel: 'global' | 'agents', extra = '') =>
  useQuery({ queryKey: ['messages', channel, extra], queryFn: () => get<Message[]>(`/messages?channel=${channel}${extra}`) });
export const useActivity = (params = '') => useQuery({ queryKey: ['activity', params], queryFn: () => get<Activity[]>(`/activity${params}`) });
export const useAlerts = () => useQuery({ queryKey: ['alerts'], queryFn: () => get<Alert[]>('/alerts') });
export const useApprovals = (status = 'pending') => useQuery({ queryKey: ['approvals', status], queryFn: () => get<Approval[]>(`/approvals?status=${status}`) });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/projects') });
export const useProject = (id: string | null) => useQuery({ queryKey: ['project', id], queryFn: () => get<any>(`/projects/${id}`), enabled: !!id });
export const useKnowledge = (params = '') => useQuery({ queryKey: ['knowledge', params], queryFn: () => get<Knowledge[]>(`/knowledge${params}`) });
export const useFiles = (params = '') => useQuery({ queryKey: ['files', params], queryFn: () => get<StoredFile[]>(`/files${params}`) });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => get<any>('/overview') });
export const useSystemInfo = () => useQuery({ queryKey: ['system'], queryFn: () => get<any>('/system/info') });

/** Mutation with toast feedback and broad invalidation. */
export function useAction<TArgs = void, TRes = unknown>(fn: (args: TArgs) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: string[][] } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.push({ kind: 'success', text: typeof opts.success === 'function' ? opts.success(r) : opts.success });
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e: any) => toast.push({ kind: 'error', text: e?.message ?? String(e) }),
  });
}
