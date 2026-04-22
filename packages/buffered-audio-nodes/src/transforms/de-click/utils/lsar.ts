// Least-Squares AutoRegressive (LSAR) interpolation per G&R §6.2.
//
// Given detected click-region indices I = {i₁, ..., i_m} and the AR
// coefficients {a[1], ..., a[p]} used for detection, find replacement samples
// x_I that minimise:
//   J = Σ_{n ∈ N} (x[n] + Σₖ a[k] · x[n−k])²
// where N = {n : the residual e[n] = x[n] + Σₖ a[k] x[n−k] depends on any
// gap sample}. Concretely, N spans [min(I), max(I) + p] — every residual that
// touches a gap column.
//
// With non-gap samples held fixed, J is quadratic in x_I and the stationary
// point is the solution of:
//   (Bᵀ B) · x_I = −Bᵀ d
// where B is the block of the AR-convolution matrix indexed by gap columns
// and d is the AR convolution of the known samples at rows that overlap the
// gap. `BᵀB` is the Gram matrix of the gap columns — symmetric positive
// semi-definite by construction.
//
// We solve via Cholesky decomposition with small diagonal regularisation
// (ε = 1e-8 · tr(BᵀB) / m) to handle near-singular configurations, per G&R
// §6.2's numerical-stability notes.

const REGULARISATION_EPSILON = 1e-8;

/**
 * Interpolate the samples at indices `gapIndices` in `signal` in place, using
 * the surrounding samples and the AR coefficients `coeffs`.
 *
 * `coeffs[k-1]` is the AR coefficient at lag `k`, matching `burgMethod`:
 *   pred[n] = −Σ_{k=1..p} coeffs[k-1] · signal[n-k]
 * so the residual at n is signal[n] + Σ_{k=1..p} coeffs[k-1] · signal[n-k].
 *
 * The gap set does not need to be contiguous — disjoint click regions are
 * handled as one linear system if any rows of `N` touch more than one gap
 * (which happens when two gaps are within `p` samples of each other). For
 * far-apart gaps this still works but the Gram matrix is block-diagonal; the
 * Cholesky solve handles both cases uniformly.
 *
 * Gap indices must satisfy `gapIndices[i] >= p` and
 * `gapIndices[i] + p < signal.length`: the AR model needs `p` known samples
 * to each side of the gap span (equivalently, `min(I) >= p` and
 * `max(I) + p < signal.length`). Indices outside that guarded range are
 * skipped with no modification.
 */
export function lsarInterpolate(signal: Float32Array, gapIndices: ReadonlyArray<number>, coeffs: Float32Array): void {
	const order = coeffs.length;
	const length = signal.length;

	if (gapIndices.length === 0 || order === 0) return;

	// Filter to indices that have enough history and lookahead for the AR
	// model to define residuals that touch the gap. G&R §6.2 requires `p`
	// known samples on each side of the gap span.
	const validGap: Array<number> = [];

	for (const gapIndex of gapIndices) {
		if (gapIndex >= order && gapIndex + order < length) validGap.push(gapIndex);
	}

	if (validGap.length === 0) return;

	validGap.sort((left, right) => left - right);

	const gapSize = validGap.length;
	const minGap = validGap[0] ?? 0;
	const maxGap = validGap[gapSize - 1] ?? 0;
	const rowStart = minGap;
	const rowEnd = Math.min(length, maxGap + order + 1);
	const numRows = rowEnd - rowStart;

	if (numRows <= 0) return;

	// Map gap sample index -> column in B. Non-gap columns are never stored —
	// we only need the Gram Bᵀ B (gapSize × gapSize) and the vector Bᵀ d.
	const gapIndexToColumn = new Map<number, number>();

	for (let col = 0; col < gapSize; col++) gapIndexToColumn.set(validGap[col] ?? 0, col);

	// For each row n ∈ [rowStart, rowEnd), the residual is
	//   e[n] = signal[n] + Σ_{k=1..p} coeffs[k-1] · signal[n-k]
	// The "AR convolution matrix" B has entry
	//   B[row, col] = 1                        if row == validGap[col]
	//                 coeffs[row − validGap[col] − 1]   if 1 ≤ row − validGap[col] ≤ p
	//                 0                         otherwise
	//
	// `d` is the part of e[n] that only involves known (non-gap) samples:
	//   d[row] = signal[n] (if n not in gap, else 0)
	//          + Σ_{k=1..p} (signal[n-k] if n-k not in gap else 0) · coeffs[k-1]
	//
	// The normal equations (BᵀB) · x_I = −Bᵀ d follow directly.

	// Build B as a sparse representation per row: each row has at most
	// `order + 1` non-zero column entries (the "self" entry plus up to `order`
	// AR-lag entries). Storing per-row triples keeps allocation O(numRows · order).
	// Gram matrix entries are accumulated directly from each row's sparse list.
	const gram = new Float64Array(gapSize * gapSize);
	const btd = new Float64Array(gapSize);

	// Scratch: for each row we collect up to `order + 1` (col, value) pairs
	// representing non-zero B entries, and accumulate d[row] separately.
	const rowCols = new Int32Array(order + 1);
	const rowVals = new Float64Array(order + 1);

	for (let row = rowStart; row < rowEnd; row++) {
		let rowNnz = 0;
		let dRow = 0;

		// Self term: B[row, col(row)] = 1 if row is a gap index.
		{
			const col = gapIndexToColumn.get(row);

			if (col !== undefined) {
				rowCols[rowNnz] = col;
				rowVals[rowNnz] = 1;
				rowNnz++;
			} else {
				dRow += signal[row] ?? 0;
			}
		}

		// AR-lag terms: for k = 1..order, sample at (row − k) with coeff coeffs[k-1].
		for (let lag = 1; lag <= order; lag++) {
			const neighbour = row - lag;

			if (neighbour < 0) continue;

			const coeff = coeffs[lag - 1] ?? 0;
			const col = gapIndexToColumn.get(neighbour);

			if (col !== undefined) {
				rowCols[rowNnz] = col;
				rowVals[rowNnz] = coeff;
				rowNnz++;
			} else {
				dRow += coeff * (signal[neighbour] ?? 0);
			}
		}

		// Accumulate into Gram matrix: Gram[i,j] += B[row,i] · B[row,j]
		for (let lhsSlot = 0; lhsSlot < rowNnz; lhsSlot++) {
			const lhsCol = rowCols[lhsSlot] ?? 0;
			const lhsVal = rowVals[lhsSlot] ?? 0;

			btd[lhsCol] = (btd[lhsCol] ?? 0) + lhsVal * dRow;

			for (let rhsSlot = 0; rhsSlot < rowNnz; rhsSlot++) {
				const rhsCol = rowCols[rhsSlot] ?? 0;
				const rhsVal = rowVals[rhsSlot] ?? 0;

				gram[lhsCol * gapSize + rhsCol] = (gram[lhsCol * gapSize + rhsCol] ?? 0) + lhsVal * rhsVal;
			}
		}
	}

	// Negate Bᵀd to form the RHS of the normal equations x_I = (BᵀB)⁻¹ · (−Bᵀd).
	for (let col = 0; col < gapSize; col++) btd[col] = -(btd[col] ?? 0);

	// Diagonal regularisation: ε · tr(BᵀB) / m (G&R §6.2 numerical note).
	let trace = 0;

	for (let col = 0; col < gapSize; col++) trace += gram[col * gapSize + col] ?? 0;

	const regularisation = REGULARISATION_EPSILON * (trace / Math.max(1, gapSize));

	for (let col = 0; col < gapSize; col++) gram[col * gapSize + col] = (gram[col * gapSize + col] ?? 0) + regularisation;

	// Cholesky decomposition: Gram = L · Lᵀ, solved in place by column sweep.
	// On numerical failure (non-PSD after regularisation — should not occur
	// with valid AR coefficients), the gap is left unmodified rather than
	// producing NaNs.
	const choleskyOk = choleskyDecompose(gram, gapSize);

	if (!choleskyOk) return;

	const solution = new Float64Array(gapSize);

	choleskyForwardSolve(gram, btd, solution, gapSize);
	choleskyBackSolve(gram, solution, gapSize);

	for (let col = 0; col < gapSize; col++) signal[validGap[col] ?? 0] = solution[col] ?? 0;
}

/**
 * Group gap indices into contiguous runs, returning disjoint ordered index
 * arrays. Useful if the caller wants to solve each contiguous region
 * independently — smaller systems are faster, and regions more than `order`
 * samples apart are algebraically independent under the LSAR Gram structure.
 */
export function groupContiguousGaps(gapIndices: ReadonlyArray<number>): Array<Array<number>> {
	if (gapIndices.length === 0) return [];

	const sorted = [...gapIndices].sort((left, right) => left - right);
	const groups: Array<Array<number>> = [];
	let current: Array<number> = [sorted[0] ?? 0];

	for (let pos = 1; pos < sorted.length; pos++) {
		const prev = sorted[pos - 1] ?? 0;
		const gapIndex = sorted[pos] ?? 0;

		if (gapIndex === prev + 1) {
			current.push(gapIndex);
		} else {
			groups.push(current);
			current = [gapIndex];
		}
	}

	groups.push(current);

	return groups;
}

// ---------------------------------------------------------------------------
// Cholesky routines. Operate on a flat `n × n` Float64Array stored row-major.
// After choleskyDecompose, the lower triangle (including diagonal) holds L.
// ---------------------------------------------------------------------------

function choleskyDecompose(matrix: Float64Array, size: number): boolean {
	for (let col = 0; col < size; col++) {
		let diag = matrix[col * size + col] ?? 0;

		for (let inner = 0; inner < col; inner++) {
			const lkc = matrix[col * size + inner] ?? 0;

			diag -= lkc * lkc;
		}

		if (!(diag > 0) || !Number.isFinite(diag)) return false;

		const diagSqrt = Math.sqrt(diag);

		matrix[col * size + col] = diagSqrt;

		for (let row = col + 1; row < size; row++) {
			let sum = matrix[row * size + col] ?? 0;

			for (let inner = 0; inner < col; inner++) {
				sum -= (matrix[row * size + inner] ?? 0) * (matrix[col * size + inner] ?? 0);
			}

			matrix[row * size + col] = sum / diagSqrt;
		}
	}

	return true;
}

function choleskyForwardSolve(lower: Float64Array, rhs: Float64Array, out: Float64Array, size: number): void {
	for (let row = 0; row < size; row++) {
		let sum = rhs[row] ?? 0;

		for (let col = 0; col < row; col++) {
			sum -= (lower[row * size + col] ?? 0) * (out[col] ?? 0);
		}

		out[row] = sum / (lower[row * size + row] ?? 1);
	}
}

function choleskyBackSolve(lower: Float64Array, xInOut: Float64Array, size: number): void {
	for (let row = size - 1; row >= 0; row--) {
		let sum = xInOut[row] ?? 0;

		for (let col = row + 1; col < size; col++) {
			sum -= (lower[col * size + row] ?? 0) * (xInOut[col] ?? 0);
		}

		xInOut[row] = sum / (lower[row * size + row] ?? 1);
	}
}
