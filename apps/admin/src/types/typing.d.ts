declare namespace API {
  interface ResponseData<T> {
    code: number;
    message: string;
    data: T;
  }

  interface Page<T> {
    total: number;
    records: T[];
    current: number;
    size: number;
    pages: number;
  }
}
