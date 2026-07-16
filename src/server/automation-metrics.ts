import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { WorkflowAction, TriggerType, TriggerConfig } from "@/lib/automation-types";

/** Read layer for the Automation engine (Synamate "Workflows"). */

export type WorkflowRow = {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  actionCount: number;
  totalEnrolled: number;
  activeEnrolled: number;
  updatedAt: Date;
  folderId: string | null;
  deletedAt: Date | null;
};

export type FolderRow = { id: string; name: string; workflowCount: number };

/** `activeEnrolled` is a filtered relation count, so every list read shares this include. */
const workflowRowSelect = {
  include: { _count: { select: { enrollments: { where: { status: "ACTIVE" as const } } } } },
} satisfies Prisma.WorkflowDefaultArgs;

function toRow(w: Prisma.WorkflowGetPayload<typeof workflowRowSelect>): WorkflowRow {
  return {
    id: w.id,
    name: w.name,
    status: w.status,
    triggerType: w.triggerType,
    actionCount: Array.isArray(w.actions) ? (w.actions as unknown[]).length : 0,
    totalEnrolled: w.totalEnrolled,
    activeEnrolled: w._count.enrollments,
    updatedAt: w.updatedAt,
    folderId: w.folderId,
    deletedAt: w.deletedAt,
  };
}

/**
 * Live workflows for one folder view. `folderId` null = the root ("Home") listing, which shows
 * only unfoldered workflows — the folders themselves are listed separately by `getFolders`,
 * exactly as the Synamate reference does it. Soft-deleted rows never appear here.
 */
export async function getWorkflowsList(folderId: string | null = null): Promise<WorkflowRow[]> {
  const workflows = await prisma.workflow.findMany({
    where: { deletedAt: null, folderId },
    orderBy: { updatedAt: "desc" },
    ...workflowRowSelect,
  });
  return workflows.map(toRow);
}

/** Folders + how many live workflows each holds (the count shown on the folder row). */
export async function getFolders(): Promise<FolderRow[]> {
  const folders = await prisma.workflowFolder.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { workflows: { where: { deletedAt: null } } } } },
  });
  return folders.map((f) => ({ id: f.id, name: f.name, workflowCount: f._count.workflows }));
}

export async function getFolder(id: string): Promise<{ id: string; name: string } | null> {
  return prisma.workflowFolder.findUnique({ where: { id }, select: { id: true, name: true } });
}

/** The "Deleted" tab: soft-deleted workflows across every folder, most recently deleted first. */
export async function getDeletedWorkflows(): Promise<WorkflowRow[]> {
  const workflows = await prisma.workflow.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    ...workflowRowSelect,
  });
  return workflows.map(toRow);
}

export async function getDeletedCount(): Promise<number> {
  return prisma.workflow.count({ where: { deletedAt: { not: null } } });
}

export type WorkflowDetail = {
  id: string;
  name: string;
  status: string;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  actions: WorkflowAction[];
  totalEnrolled: number;
  folderId: string | null;
  deletedAt: Date | null;
  enrollments: { id: string; leadId: string; leadName: string; status: string; step: number; nextRunAt: Date | null }[];
};

export async function getWorkflow(id: string): Promise<WorkflowDetail | null> {
  const w = await prisma.workflow.findUnique({
    where: { id },
    include: {
      enrollments: {
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: { lead: { select: { id: true, name: true } } },
      },
    },
  });
  if (!w) return null;
  return {
    id: w.id,
    name: w.name,
    status: w.status,
    triggerType: w.triggerType as TriggerType,
    triggerConfig: (w.triggerConfig as TriggerConfig) ?? {},
    actions: (w.actions as WorkflowAction[]) ?? [],
    totalEnrolled: w.totalEnrolled,
    folderId: w.folderId,
    deletedAt: w.deletedAt,
    enrollments: w.enrollments.map((e) => ({
      id: e.id,
      leadId: e.lead.id,
      leadName: e.lead.name,
      status: e.status,
      step: e.currentStep,
      nextRunAt: e.nextRunAt,
    })),
  };
}

export async function getWorkflowPickers() {
  const [forms, tags, templates, users, folders] = await Promise.all([
    prisma.form.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.messageTemplate.findMany({ select: { id: true, name: true, channel: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.workflowFolder.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    forms,
    tags: tags.map((t) => t.name),
    templates: templates.map((t) => ({ id: t.id, name: t.name, channel: t.channel as "EMAIL" | "SMS" })),
    users,
    folders,
  };
}
