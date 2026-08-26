export const DAILY_TASK_PUBLISH_LIMIT = 10;

export function publishRewardForAttempt(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > DAILY_TASK_PUBLISH_LIMIT) return 0;
  return DAILY_TASK_PUBLISH_LIMIT - attempt + 1;
}

export function isSameUtcDay(left: Date | null | undefined, right: Date) {
  return Boolean(left) && left!.getUTCFullYear() === right.getUTCFullYear()
    && left!.getUTCMonth() === right.getUTCMonth()
    && left!.getUTCDate() === right.getUTCDate();
}
