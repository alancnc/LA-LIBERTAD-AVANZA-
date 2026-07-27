import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las suites que usan Postgres comparten la misma base y una de ellas hace
    // TRUNCATE entre tests. Corriendo los archivos de a uno, ninguna borra los
    // datos de la otra a mitad de camino.
    fileParallelism: false,
  },
});
