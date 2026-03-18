"use client";

import { z } from "zod";
import UniversalForm from "@/components/universal-form/UniversalForm";
import { FieldConfig } from "@/components/universal-form/form.types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  TransportManagerTrainingRenewalTracker,
  TransportManagerTrainingRow,
  UpdateTransportManagerTrainingInput,
} from "@/lib/transport-manager-training/transport-manager-training.types";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const editTrainingSchema = z.object({
  trainingCourse: z
    .string()
    .min(1, "Training course is required")
    .max(200, "Training course is too long"),
  unitTitle: z
    .string()
    .min(1, "Unit title is required")
    .max(200, "Unit title is too long"),
  completionDate: z.string().min(1, "Completion date is required"),
  renewalTracker: z.nativeEnum(TransportManagerTrainingRenewalTracker),
  nextDueDate: z.string().optional(),
  attachments: z.any().optional(),
});

type EditTrainingForm = z.infer<typeof editTrainingSchema>;

interface EditTransportManagerTrainingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: UpdateTransportManagerTrainingInput) => Promise<void> | void;
  training: TransportManagerTrainingRow | null;
  loading: boolean;
}

function toDateInput(value?: string | Date): string {
  if (!value) return "";
  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

export default function EditTransportManagerTrainingModal({
  open,
  onOpenChange,
  onSubmit,
  training,
  loading,
}: EditTransportManagerTrainingModalProps) {
  const [removeAttachmentIds, setRemoveAttachmentIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setRemoveAttachmentIds([]);
    }
  }, [open, training?._id]);

  const fields: FieldConfig<EditTrainingForm>[] = [
    {
      name: "trainingCourse",
      label: "Training Course",
      type: "text",
      required: true,
    },
    {
      name: "unitTitle",
      label: "Unit Title",
      type: "text",
      required: true,
    },
    {
      name: "completionDate",
      label: "Completion Date",
      type: "date",
      required: true,
    },
    {
      name: "renewalTracker",
      label: "Renewal Tracker",
      type: "select",
      options: [
        { label: "No", value: TransportManagerTrainingRenewalTracker.NO },
        {
          label: "Recommended",
          value: TransportManagerTrainingRenewalTracker.RECOMMENDED,
        },
      ],
      required: true,
    },
    {
      name: "nextDueDate",
      label: "Next Due Date",
      type: "date",
    },
    {
      name: "attachments",
      label: "Add New Attachments",
      type: "file",
      multiple: true,
    },
  ];

  const toggleRemoveAttachment = (attachmentId: string) => {
    setRemoveAttachmentIds((prev) => {
      if (prev.includes(attachmentId)) {
        return prev.filter((id) => id !== attachmentId);
      }
      return [...prev, attachmentId];
    });
  };

  const renderAttachmentRemoveSection = () => {
    if (!training) return null;

    if (!training.attachments?.length) {
      return (
        <div className="mt-4 rounded-md border p-3">
          <p className="text-sm font-semibold">Remove Existing Attachments</p>
          <p className="text-muted-foreground mt-2 text-sm">
            No attachments found.
          </p>
        </div>
      );
    }

    return (
      <div className="mt-4 rounded-md border p-3">
        <p className="text-sm font-semibold">Remove Existing Attachments</p>
        <div className="mt-2 space-y-2">
          {training.attachments.map((attachment) => {
            const markedForRemoval = removeAttachmentIds.includes(
              attachment._id,
            );

            return (
              <div
                key={attachment._id}
                className="flex items-center justify-between gap-3 rounded-md border p-2"
              >
                <span
                  className={`min-w-0 truncate text-sm ${markedForRemoval ? "text-red-600 line-through" : ""}`}
                >
                  {attachment.originalName || attachment.filename}
                </span>

                <div className="flex items-center gap-2">
                  <a
                    href={attachment.downloadUrl || attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>

                  <button
                    type="button"
                    onClick={() => toggleRemoveAttachment(attachment._id)}
                    className={
                      markedForRemoval
                        ? "text-red-600 hover:text-red-700"
                        : "text-muted-foreground hover:text-red-600"
                    }
                    title={
                      markedForRemoval ? "Undo remove" : "Remove on update"
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {removeAttachmentIds.length > 0 ? (
          <p className="mt-2 text-xs text-amber-600">
            {removeAttachmentIds.length} attachment(s) marked for removal on
            update.
          </p>
        ) : null}
      </div>
    );
  };

  const handleFormSubmit = async (data: EditTrainingForm) => {
    const attachmentFiles = data.attachments
      ? Array.from(data.attachments as FileList)
      : undefined;

    await onSubmit({
      trainingCourse: data.trainingCourse,
      unitTitle: data.unitTitle,
      completionDate: data.completionDate,
      renewalTracker: data.renewalTracker,
      ...(data.nextDueDate && { nextDueDate: data.nextDueDate }),
      ...(attachmentFiles?.length && { attachments: attachmentFiles }),
      ...(removeAttachmentIds.length && { removeAttachmentIds }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-primary mb-4 text-xl font-bold">
          Edit Transport Manager Training
        </DialogTitle>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
          </div>
        ) : training ? (
          <UniversalForm<EditTrainingForm>
            key={training._id}
            title="Training Details"
            schema={editTrainingSchema}
            fields={fields}
            defaultValues={{
              trainingCourse: training.trainingCourse || "",
              unitTitle: training.unitTitle || "",
              completionDate: toDateInput(training.completionDate),
              renewalTracker:
                training.renewalTracker ||
                TransportManagerTrainingRenewalTracker.NO,
              nextDueDate: toDateInput(training.nextDueDate),
              attachments: undefined,
            }}
            onSubmit={handleFormSubmit}
            submitText="Update Training"
            setOpen={onOpenChange}
            renderAfterField={(fieldName) =>
              fieldName === "attachments"
                ? renderAttachmentRemoveSection()
                : null
            }
          />
        ) : (
          <div className="flex h-40 items-center justify-center">
            <p className="text-muted-foreground">No training data available</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
