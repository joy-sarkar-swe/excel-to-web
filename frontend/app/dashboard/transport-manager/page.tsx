"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import TransportManagerTrainingHeader from "@/components/dashboard/transport-manager/TransportManagerHeader";
import TransportManagerTrainingTable, {
  toTransportManagerTrainingTableRows,
  TransportManagerTrainingTableRow,
} from "@/components/dashboard/transport-manager/TransportManagerTable";
import AddTransportManagerTrainingModal from "@/components/dashboard/transport-manager/AddTransportManagerModal";
import ViewTransportManagerTrainingModal from "@/components/dashboard/transport-manager/ViewTransportManagerModal";
import EditTransportManagerTrainingModal from "@/components/dashboard/transport-manager/EditTransportManagerModal";
import DeleteTransportManagerTrainingDialog from "@/components/dashboard/transport-manager/DeleteTransportManagerDialog";

import {
  CreateTransportManagerTrainingInput,
  TransportManagerTrainingRow,
  UpdateTransportManagerTrainingInput,
} from "@/lib/transport-manager-training/transport-manager-training.types";
import { TransportManagerTrainingAction } from "@/service/transport-manager-training";

function resolveTrainingPayload(
  payload: unknown,
): TransportManagerTrainingRow | null {
  if (!payload) return null;

  if (Array.isArray(payload)) {
    return payload.length ? resolveTrainingPayload(payload[0]) : null;
  }

  if (typeof payload !== "object") return null;

  const direct = payload as Partial<TransportManagerTrainingRow>;
  if (typeof direct._id === "string") {
    return payload as TransportManagerTrainingRow;
  }

  const maybeNested = payload as {
    data?: unknown;
    training?: unknown;
    transportManagerTraining?: unknown;
    result?: unknown;
    item?: unknown;
  };

  const nestedCandidates = [
    maybeNested.data,
    maybeNested.training,
    maybeNested.transportManagerTraining,
    maybeNested.result,
    maybeNested.item,
  ];

  for (const candidate of nestedCandidates) {
    const resolved = resolveTrainingPayload(candidate);
    if (resolved) return resolved;
  }

  const nested = (payload as { data?: Partial<TransportManagerTrainingRow> })
    .data;
  if (nested && typeof nested._id === "string") {
    return nested as TransportManagerTrainingRow;
  }

  return null;
}

export default function TransportManagerTrainingPage() {
  const [rows, setRows] = useState<TransportManagerTrainingTableRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewTraining, setViewTraining] =
    useState<TransportManagerTrainingRow | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTraining, setEditTraining] =
    useState<TransportManagerTrainingRow | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<TransportManagerTrainingTableRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTrainings = useCallback(async (search?: string) => {
    try {
      setLoading(true);
      const res = await TransportManagerTrainingAction.getTrainings({
        searchKey: search || undefined,
        showPerPage: 100,
      });

      if (res.status && res.data) {
        setRows(
          toTransportManagerTrainingTableRows(
            res.data.transportManagerTrainings,
          ),
        );
      } else {
        setError(res.message || "Failed to load transport manager training");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load transport manager training",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrainings();
  }, [fetchTrainings]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchTrainings(value);
    }, 400);
  };

  const handleCreateTraining = async (
    data: CreateTransportManagerTrainingInput,
  ) => {
    try {
      const res = await TransportManagerTrainingAction.createTraining(data);
      if (res.status) {
        toast.success(res.message || "Training created successfully");
        setAddOpen(false);
        fetchTrainings(searchQuery);
      } else {
        toast.error(res.message || "Failed to create training");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create training",
      );
    }
  };

  const handleView = async (row: TransportManagerTrainingTableRow) => {
    setViewOpen(true);
    setViewLoading(true);

    try {
      const res = await TransportManagerTrainingAction.getTraining(row._id);
      const trainingData = resolveTrainingPayload(res.data);

      if (res.status && trainingData) {
        setViewTraining(trainingData);
      } else {
        if (res.status) {
          setViewTraining({
            _id: row._id,
            name: row.name,
            trainingCourse: row.trainingCourse,
            unitTitle: row.unitTitle,
            completionDate: row.completionDate,
            renewalTracker: row.renewalTracker,
            nextDueDate: row.nextDueDate,
            attachments: [],
            createdBy: "",
          });
        } else {
          toast.error(res.message || "Failed to load training details");
          setViewOpen(false);
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load training details",
      );
      setViewOpen(false);
    } finally {
      setViewLoading(false);
    }
  };

  const handleEditOpen = async (row: TransportManagerTrainingTableRow) => {
    setEditOpen(true);
    setEditLoading(true);

    try {
      const res = await TransportManagerTrainingAction.getTraining(row._id);
      const trainingData = resolveTrainingPayload(res.data);

      if (res.status && trainingData) {
        setEditTraining(trainingData);
      } else {
        if (res.status) {
          setEditTraining({
            _id: row._id,
            name: row.name,
            trainingCourse: row.trainingCourse,
            unitTitle: row.unitTitle,
            completionDate: row.completionDate,
            renewalTracker: row.renewalTracker,
            nextDueDate: row.nextDueDate,
            attachments: [],
            createdBy: "",
          });
        } else {
          toast.error(res.message || "Failed to load training details");
          setEditOpen(false);
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load training details",
      );
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  };

  const handleUpdateTraining = async (
    data: UpdateTransportManagerTrainingInput,
  ) => {
    if (!editTraining) return;

    try {
      const res = await TransportManagerTrainingAction.updateTraining(
        editTraining._id,
        data,
      );

      if (res.status) {
        toast.success(res.message || "Training updated successfully");
        setEditOpen(false);
        setEditTraining(null);
        fetchTrainings(searchQuery);
      } else {
        toast.error(res.message || "Failed to update training");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update training",
      );
    }
  };

  const handleDeleteOpen = (row: TransportManagerTrainingTableRow) => {
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    setDeleteLoading(true);
    try {
      const res = await TransportManagerTrainingAction.deleteTraining(
        deleteTarget._id,
      );
      if (res.status) {
        toast.success(res.message || "Training deleted successfully");
        setDeleteOpen(false);
        setDeleteTarget(null);
        fetchTrainings(searchQuery);
      } else {
        toast.error(res.message || "Failed to delete training");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete training",
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  if (error) {
    return (
      <div className="container mx-auto max-w-6xl py-10">
        <div className="flex h-64 items-center justify-center">
          <p className="text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="container mx-auto max-w-6xl py-10">
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">
            Loading transport manager training...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto py-4 lg:mr-10">
      <TransportManagerTrainingHeader
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
      />

      <TransportManagerTrainingTable
        data={rows}
        onAddTraining={() => setAddOpen(true)}
        onView={handleView}
        onEdit={handleEditOpen}
        onDelete={handleDeleteOpen}
      />

      <AddTransportManagerTrainingModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={handleCreateTraining}
      />

      <ViewTransportManagerTrainingModal
        open={viewOpen}
        onOpenChange={(open) => {
          setViewOpen(open);
          if (!open) setViewTraining(null);
        }}
        training={viewTraining}
        loading={viewLoading}
      />

      <EditTransportManagerTrainingModal
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditTraining(null);
        }}
        onSubmit={handleUpdateTraining}
        training={editTraining}
        loading={editLoading}
      />

      <DeleteTransportManagerTrainingDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteTarget(null);
        }}
        trainingCourse={deleteTarget?.trainingCourse || ""}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
      />
    </div>
  );
}
