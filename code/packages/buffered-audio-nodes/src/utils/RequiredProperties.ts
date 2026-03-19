export type RequiredProperties<D extends object, K extends keyof D> = Pick<D, K> & Partial<Omit<D, K>>;

export type OptionalProperties<D extends object, K extends keyof D> = Omit<D, K> & Partial<Pick<D, K>>;
