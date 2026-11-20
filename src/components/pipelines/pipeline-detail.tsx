"use client";

import { useState } from "react";
import type { PipelineRecord } from "@/server/pipelines";
import type { ProspectRecord } from "@/server/prospects";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

export function PipelineDetail({ pipeline, prospect }: { pipeline: PipelineRecord; prospect: ProspectRecord }) {
  const [loading, setLoading] = useState(false);

  const handleTaskCheck = async (taskId: string) => {
    setLoading(true);
    try {
      // E3-S4 #2: tick in one tap
      // API route will update task
    } catch (error) {
      console.error("Task update failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <h1 className="text-20 font-600 mb-2">{prospect.name}</h1>
        <div className="flex items-center gap-2 text-14 text-muted-foreground mb-2">
          <span>{pipeline.fundingOfficer.name}</span>
          <span>•</span>
          <span>{pipeline.template.name}</span>
        </div>
        {/* Stage badge and progress */}
        <div className="flex items-center gap-2 mb-4">
          <Badge>{pipeline.currentStagePosition}/{pipeline.stageCount}</Badge>
          <span className="text-14">{pipeline.tasksDone}/{pipeline.tasksTotal} Tugas</span>
        </div>
        {pipeline.outcome && <Badge variant="outline">{pipeline.outcome}</Badge>}
      </div>

      {/* Tahap saat ini */}
      {pipeline.currentStage && (
        <div className="border-b p-4">
          <h2 className="text-16 font-500 mb-4">Tahap saat ini</h2>
          <div className="space-y-3">
            {pipeline.stages
              .find((s) => s.position === pipeline.currentStagePosition)
              ?.tasks.map((task) => (
                <label key={task.id} className="flex items-start gap-3 p-2 cursor-pointer hover:bg-accent rounded">
                  <input type="checkbox" checked={task.done} disabled={loading} onChange={() => handleTaskCheck(task.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="text-16 font-400">{task.name}</div>
                    {task.dueOn && (
                      <div className={`text-14 ${task.overdue ? "text-warning" : "text-muted-foreground"}`}>
                        Jatuh tempo {task.dueOn}
                        {task.overdue && (
                          <>
                            <br />
                            <div className="flex items-center gap-1 text-warning">
                              <Clock className="w-4 h-4" /> Terlambat
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              ))}
          </div>
        </div>
      )}

      {/* Semua tahap */}
      <div className="border-b p-4">
        <h2 className="text-16 font-500 mb-4">Semua tahap</h2>
        <div className="space-y-2">
          {pipeline.stages.map((stage) => (
            <div key={stage.id} className="p-3 bg-surface rounded">
              <div className="flex items-center justify-between">
                <span className="text-16 font-400">
                  {stage.position} {stage.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-14 text-muted-foreground">
                    {stage.tasksDone}/{stage.tasksTotal}
                  </span>
                  {stage.position === pipeline.currentStagePosition && <span className="text-primary">◀</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions (sticky) */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border flex gap-2 safe-area-bottom">
        <Button variant="outline" disabled={loading}>
          Tandai berhasil
        </Button>
        <Button disabled={loading}>Pindah ke tahap berikutnya</Button>
      </div>

      {/* Bottom padding for sticky actions */}
      <div className="h-20" />
    </div>
  );
}
