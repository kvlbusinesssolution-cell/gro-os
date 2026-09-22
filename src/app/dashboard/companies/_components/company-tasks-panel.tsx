import Link from "next/link";
import { CheckSquare } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface CompanyTaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  isOverdue: boolean;
  assignedToName: string | null;
}

export interface CompanyReminderRow {
  id: string;
  title: string;
  remindAt: string;
  dismissed: boolean;
  isPast: boolean;
}

const TASK_STATUS_CLASSNAME: Record<string, string> = {
  COMPLETED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  BLOCKED: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  CANCELLED: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  RUNNING: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  REVIEW: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PENDING: "border-border bg-muted text-muted-foreground",
  BACKLOG: "border-border bg-muted text-muted-foreground",
};

const PRIORITY_CLASSNAME: Record<string, string> = {
  URGENT: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  HIGH: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  NORMAL: "border-border bg-muted text-muted-foreground",
  LOW: "border-border bg-transparent text-muted-foreground",
};

function taskStatusClassName(status: string): string {
  return TASK_STATUS_CLASSNAME[status] ?? "border-border bg-muted text-muted-foreground";
}

function priorityClassName(priority: string): string {
  return PRIORITY_CLASSNAME[priority] ?? "border-border bg-muted text-muted-foreground";
}

/**
 * Tasks + Reminders for this company — both real Company relations that
 * `CrmActionsPanel` (elsewhere on this page) can CREATE against, but
 * neither was ever rendered here, so existing tasks/reminders were
 * invisible without leaving the page. `isOverdue`/`isPast` are precomputed
 * server-side by the caller (comparing against "now" at query time) —
 * this component never calls `Date.now()` itself.
 */
export function CompanyTasksPanel({
  tasks,
  reminders,
}: {
  tasks: CompanyTaskRow[];
  reminders: CompanyReminderRow[];
}) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckSquare className="size-4" /> Tasks &amp; Reminders
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-foreground">Tasks ({tasks.length})</p>
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks for this company yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Badge variant="outline" className={priorityClassName(task.priority)}>
                      {task.priority}
                    </Badge>
                    <span className="truncate text-foreground">{task.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {task.assignedToName && <span className="text-xs text-muted-foreground">{task.assignedToName}</span>}
                    {task.dueDate && (
                      <span className={`text-xs ${task.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    <Badge variant="outline" className={taskStatusClassName(task.status)}>
                      {task.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link href="/dashboard/crm/tasks" className="text-xs text-primary hover:underline">
            Manage tasks →
          </Link>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <p className="text-xs font-semibold text-foreground">Reminders ({reminders.length})</p>
          {reminders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reminders set for this company.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {reminders.map((reminder) => (
                <div key={reminder.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="truncate text-foreground">{reminder.title}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`text-xs ${
                        reminder.dismissed
                          ? "text-muted-foreground"
                          : reminder.isPast
                            ? "font-medium text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {new Date(reminder.remindAt).toLocaleDateString()}
                    </span>
                    {reminder.dismissed && (
                      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                        Dismissed
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
