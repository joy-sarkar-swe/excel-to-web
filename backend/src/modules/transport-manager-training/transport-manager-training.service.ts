// Import the model
import mongoose from 'mongoose';
import { UploadedFile } from 'express-fileupload';
import TransportManagerTrainingModel, {
  ITransportManagerTraining,
} from '../../models/training/transportManagerTraining.schema';
import { User } from '../../models';
import { IdOrIdsInput, SearchQueryInput } from '../../handlers/common-zod-validator';
import DocumentModel from '../../models/document.schema';
import { deleteObjects, getSignedDownloadUrl } from '../../utils/aws/s3';
import {
  rollbackUploadedDocuments,
  uploadFilesAndCreateDocuments,
} from '../../utils/aws/document-upload';
import {
  CreateTransportManagerTrainingInput,
  UpdateTransportManagerTrainingInput,
} from './transport-manager-training.validation';

interface TransportManagerTrainingAttachmentResponse {
  _id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  downloadUrl: string;
}

type TransportManagerTrainingWithAttachmentsResponse = Omit<
  Partial<ITransportManagerTraining>,
  'attachments'
> & {
  attachments?: TransportManagerTrainingAttachmentResponse[];
};

const withSignedAttachmentUrls = async (
  training:
    | ITransportManagerTraining
    | (Partial<ITransportManagerTraining> & { _id: mongoose.Types.ObjectId | string })
): Promise<TransportManagerTrainingWithAttachmentsResponse> => {
  const trainingObject: any =
    typeof (training as any)?.toObject === 'function'
      ? (training as any).toObject()
      : training;

  const attachmentIds = Array.isArray(trainingObject.attachments)
    ? trainingObject.attachments
      .map((id) => {
        if (id instanceof mongoose.Types.ObjectId) return id;
        if (mongoose.Types.ObjectId.isValid(String(id))) {
          return new mongoose.Types.ObjectId(String(id));
        }
        return null;
      })
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id))
    : [];

  if (!attachmentIds.length) {
    return {
      ...(trainingObject as Partial<ITransportManagerTraining>),
      attachments: [],
    } as TransportManagerTrainingWithAttachmentsResponse;
  }

  const documents = await DocumentModel.find({ _id: { $in: attachmentIds } })
    .select('_id filename originalName mimeType size url s3Key')
    .lean();

  const signedDocuments = await Promise.all(
    documents.map(async (doc) => {
      let downloadUrl = doc.url;

      try {
        downloadUrl = await getSignedDownloadUrl(doc.s3Key);
      } catch {
        // Fallback to persisted URL if signed URL generation fails.
      }

      return {
        _id: String(doc._id),
        filename: doc.filename,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        url: doc.url,
        downloadUrl,
      } as TransportManagerTrainingAttachmentResponse;
    })
  );

  const byId = new Map(signedDocuments.map((doc) => [doc._id, doc]));
  const orderedAttachments = attachmentIds
    .map((id) => byId.get(String(id)))
    .filter((doc): doc is TransportManagerTrainingAttachmentResponse => Boolean(doc));

  return {
    ...(trainingObject as Partial<ITransportManagerTraining>),
    attachments: orderedAttachments,
  } as TransportManagerTrainingWithAttachmentsResponse;
};

const normalizeCreatePayload = (data: CreateTransportManagerTrainingInput) => ({
  ...data,
  attachments: data.attachments?.map((attachmentId) => new mongoose.Types.ObjectId(attachmentId)),
});

const normalizeUpdatePayload = (data: UpdateTransportManagerTrainingInput) => ({
  ...data,
  attachments: data.attachments?.map((attachmentId) => new mongoose.Types.ObjectId(attachmentId)),
});

const getTransportManagerNameById = async (userId: IdOrIdsInput['id']): Promise<string> => {
  const user = await User.findById(userId).select('fullName');
  if (!user?.fullName) {
    throw new Error('Transport manager profile name not found');
  }
  return user.fullName;
};

/**
 * Service function to create a new transport-manager-training.
 *
 * @param {CreateTransportManagerTrainingInput} data - The data to create a new transport-manager-training.
 * @returns {Promise<Partial<ITransportManagerTraining>>} - The created transport-manager-training.
 */
const createTransportManagerTraining = async (
  data: CreateTransportManagerTrainingInput,
  userId: IdOrIdsInput['id']
): Promise<Partial<ITransportManagerTraining>> => {
  const transportManagerName = await getTransportManagerNameById(userId);

  const newTransportManagerTraining = new TransportManagerTrainingModel({
    ...normalizeCreatePayload(data),
    name: transportManagerName,
    createdBy: new mongoose.Types.ObjectId(userId),
  });
  const savedTransportManagerTraining = await newTransportManagerTraining.save();
  return savedTransportManagerTraining;
};

/**
 * Service function to update a single transport-manager-training by ID.
 *
 * @param {IdOrIdsInput['id']} id - The ID of the transport-manager-training to update.
 * @param {UpdateTransportManagerTrainingInput} data - The updated data for the transport-manager-training.
 * @returns {Promise<Partial<ITransportManagerTraining>>} - The updated transport-manager-training.
 */
const updateTransportManagerTraining = async (
  id: IdOrIdsInput['id'],
  data: UpdateTransportManagerTrainingInput,
  userId: IdOrIdsInput['id'],
  files: UploadedFile[] = [],
  removeAttachmentIds: string[] = []
): Promise<Partial<ITransportManagerTraining | null>> => {
  const transportManagerName = await getTransportManagerNameById(userId);

  const existing = await TransportManagerTrainingModel.findOne({
    _id: id,
    createdBy: new mongoose.Types.ObjectId(userId),
  })
    .select('attachments')
    .lean();

  if (!existing) {
    return null;
  }

  const normalizedRemoveIds = Array.from(
    new Set(
      removeAttachmentIds
        .filter((item) => mongoose.Types.ObjectId.isValid(item))
        .map((item) => String(item))
    )
  );

  const currentAttachmentIds = Array.isArray(existing.attachments)
    ? existing.attachments.map((item) => String(item))
    : [];

  const removableAttachmentIds = normalizedRemoveIds.filter((item) =>
    currentAttachmentIds.includes(item)
  );

  if (removableAttachmentIds.length) {
    const documentsToDelete = await DocumentModel.find({
      _id: {
        $in: removableAttachmentIds.map((docId) => new mongoose.Types.ObjectId(docId)),
      },
    })
      .select('_id s3Key')
      .lean();

    const keysToDelete = documentsToDelete.map((doc) => doc.s3Key).filter(Boolean);

    if (keysToDelete.length) {
      await deleteObjects(keysToDelete);
    }

    if (documentsToDelete.length) {
      await DocumentModel.deleteMany({
        _id: { $in: documentsToDelete.map((doc) => doc._id) },
      });
    }
  }

  let uploadedDocuments: Awaited<ReturnType<typeof uploadFilesAndCreateDocuments>>['documents'] = [];

  if (files.length) {
    const uploadResult = await uploadFilesAndCreateDocuments(
      files,
      String(userId),
      'transport-manager-training'
    );
    uploadedDocuments = uploadResult.documents;
  }

  const sanitizedData: UpdateTransportManagerTrainingInput = { ...data };
  delete (sanitizedData as any).attachments;
  delete (sanitizedData as any).removeAttachmentIds;

  const normalizedPayload = normalizeUpdatePayload(sanitizedData);

  try {
    let updatedTransportManagerTraining: ITransportManagerTraining | null = null;

    if (Object.keys(normalizedPayload).length) {
      updatedTransportManagerTraining = await TransportManagerTrainingModel.findOneAndUpdate(
        {
          _id: id,
          createdBy: new mongoose.Types.ObjectId(userId),
        },
        {
          ...normalizedPayload,
          name: transportManagerName,
        },
        { new: true }
      );
    }

    if (removableAttachmentIds.length) {
      updatedTransportManagerTraining = await TransportManagerTrainingModel.findOneAndUpdate(
        {
          _id: id,
          createdBy: new mongoose.Types.ObjectId(userId),
        },
        {
          $pull: {
            attachments: {
              $in: removableAttachmentIds.map((docId) => new mongoose.Types.ObjectId(docId)),
            },
          },
        },
        { new: true }
      );
    }

    if (uploadedDocuments.length) {
      updatedTransportManagerTraining = await TransportManagerTrainingModel.findOneAndUpdate(
        {
          _id: id,
          createdBy: new mongoose.Types.ObjectId(userId),
        },
        {
          $addToSet: {
            attachments: {
              $each: uploadedDocuments.map((doc) => doc._id as mongoose.Types.ObjectId),
            },
          },
        },
        { new: true }
      );
    }

    if (!updatedTransportManagerTraining) {
      updatedTransportManagerTraining = await TransportManagerTrainingModel.findOne({
        _id: id,
        createdBy: new mongoose.Types.ObjectId(userId),
      });
    }

    return updatedTransportManagerTraining;
  } catch (error) {
    if (uploadedDocuments.length) {
      await rollbackUploadedDocuments(uploadedDocuments);
    }
    throw error;
  }
};

/**
 * Service function to delete a single transport-manager-training by ID.
 *
 * @param {IdOrIdsInput['id']} id - The ID of the transport-manager-training to delete.
 * @returns {Promise<Partial<ITransportManagerTraining>>} - The deleted transport-manager-training.
 */
const deleteTransportManagerTraining = async (
  id: IdOrIdsInput['id'],
  userId: IdOrIdsInput['id']
): Promise<Partial<ITransportManagerTraining | null>> => {
  const existing = await TransportManagerTrainingModel.findOne({
    _id: id,
    createdBy: new mongoose.Types.ObjectId(userId),
  })
    .select('_id attachments')
    .lean();

  if (!existing) {
    return null;
  }

  const attachmentIds = Array.isArray(existing.attachments)
    ? existing.attachments
      .map((item) => String(item))
      .filter((item) => mongoose.Types.ObjectId.isValid(item))
    : [];

  if (attachmentIds.length) {
    const documents = await DocumentModel.find({
      _id: { $in: attachmentIds.map((docId) => new mongoose.Types.ObjectId(docId)) },
    })
      .select('_id s3Key')
      .lean();

    const s3Keys = documents.map((doc) => doc.s3Key).filter(Boolean);

    if (s3Keys.length) {
      const s3DeleteResult = await deleteObjects(s3Keys);
      if (s3DeleteResult.Errors?.length) {
        throw new Error('Failed to delete one or more transport-manager-training attachment files from S3');
      }
    }

    if (documents.length) {
      await DocumentModel.deleteMany({
        _id: { $in: documents.map((doc) => doc._id) },
      });
    }

    await TransportManagerTrainingModel.updateOne(
      { _id: existing._id },
      { $set: { attachments: [] } }
    );
  }

  const deletedTransportManagerTraining = await TransportManagerTrainingModel.findOneAndDelete({
    _id: id,
    createdBy: new mongoose.Types.ObjectId(userId),
  });
  return deletedTransportManagerTraining;
};

/**
 * Service function to retrieve a single transport-manager-training by ID.
 *
 * @param {IdOrIdsInput['id']} id - The ID of the transport-manager-training to retrieve.
 * @returns {Promise<Partial<ITransportManagerTraining>>} - The retrieved transport-manager-training.
 */
const getTransportManagerTrainingById = async (
  id: IdOrIdsInput['id'],
  userId: IdOrIdsInput['id']
): Promise<TransportManagerTrainingWithAttachmentsResponse | null> => {
  const transportManagerTraining = await TransportManagerTrainingModel.findOne({
    _id: id,
    createdBy: new mongoose.Types.ObjectId(userId),
  });
  if (!transportManagerTraining) return null;
  return withSignedAttachmentUrls(transportManagerTraining);
};

/**
 * Service function to retrieve multiple transport-manager-training based on query parameters.
 *
 * @param {SearchQueryInput} query - The query parameters for filtering transport-manager-training.
 * @returns {Promise<Partial<ITransportManagerTraining>[]>} - The retrieved transport-manager-training
 */
const getManyTransportManagerTraining = async (
  query: SearchQueryInput,
  userId: IdOrIdsInput['id']
): Promise<{
  transportManagerTrainings: Partial<ITransportManagerTraining>[];
  totalData: number;
  totalPages: number;
}> => {
  const { searchKey = '', showPerPage = 10, pageNo = 1 } = query;
  // Build the search filter based on the search key
  const searchConditions = [
    { name: { $regex: searchKey, $options: 'i' } },
    { trainingCourse: { $regex: searchKey, $options: 'i' } },
    { unitTitle: { $regex: searchKey, $options: 'i' } },
  ];

  const searchFilter: any = {
    createdBy: new mongoose.Types.ObjectId(userId),
  };

  if (searchKey?.trim()) {
    searchFilter.$or = searchConditions;
  }
  // Calculate the number of items to skip based on the page number
  const skipItems = (pageNo - 1) * showPerPage;
  // Find the total count of matching transport-manager-training
  const totalData = await TransportManagerTrainingModel.countDocuments(searchFilter);
  // Calculate the total number of pages
  const totalPages = Math.ceil(totalData / showPerPage);
  // Find transport-manager-trainings based on the search filter with pagination
  const transportManagerTrainings = await TransportManagerTrainingModel.find(searchFilter)
    .skip(skipItems)
    .limit(showPerPage)
    .select(''); // Keep/Exclude any field if needed
  return { transportManagerTrainings, totalData, totalPages };
};

export const transportManagerTrainingServices = {
  createTransportManagerTraining,
  updateTransportManagerTraining,
  deleteTransportManagerTraining,
  getTransportManagerTrainingById,
  getManyTransportManagerTraining,
};
