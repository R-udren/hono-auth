const getAvatarStorageErrorDetails = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return { error }
  }

  const errorRecord = error as Record<string, unknown>
  const metadata = errorRecord.$metadata as Record<string, unknown> | undefined

  return {
    code: errorRecord.Code ?? errorRecord.code,
    httpStatusCode: metadata?.httpStatusCode,
    message: errorRecord.message,
    name: errorRecord.name,
    requestId: metadata?.requestId
  }
}

export const getAvatarStorageErrorLogDetails = (error: unknown) =>
  getAvatarStorageErrorDetails(error)

export const getAvatarStorageResponseMetadata = (response: unknown) => {
  if (typeof response !== "object" || response === null) {
    return undefined
  }

  return (response as { $metadata?: unknown }).$metadata
}
