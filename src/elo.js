const K_FACTOR = 32;

/** Update Elo ratings for two playes based on the result of a single game.*/
export function updateElos(ratingA, ratingB, resultA) {
  const resultB = 1 - resultA;

  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  return [
    ratingA + K_FACTOR * (resultA - expectedA),
    ratingB + K_FACTOR * (resultB - expectedB),
  ];
}
