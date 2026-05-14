export type ActionResult<T> =
  | {
      ok: true;
      data: T;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };
