'use strict';

var isArray = require('is-any-array');
var mlMatrix = require('ml-matrix');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var isArray__default = /*#__PURE__*/_interopDefaultLegacy(isArray);

function checkOptions(data, parameterizedFunction, options) {
  let {
    timeout,
    minValues,
    maxValues,
    initialValues,
    weights = 1,
    damping = 1e-2,
    dampingStepUp = 11,
    dampingStepDown = 9,
    maxIterations = 100,
    errorTolerance = 1e-7,
    centralDifference = false,
    gradientDifference = 10e-2,
    improvementThreshold = 1e-3,
  } = options;

  if (damping <= 0) {
    throw new Error('The damping option must be a positive number');
  } else if (!data.x || !data.y) {
    throw new Error('The data parameter must have x and y elements');
  } else if (
    !isArray__default['default'](data.x) ||
    data.x.length < 2 ||
    !isArray__default['default'](data.y) ||
    data.y.length < 2
  ) {
    throw new Error(
      'The data parameter elements must be an array with more than 2 points',
    );
  } else if (data.x.length !== data.y.length) {
    throw new Error('The data parameter elements must have the same size');
  }

  let parameters =
    initialValues || new Array(parameterizedFunction.length).fill(1);

  let nbPoints = data.y.length;
  let parLen = parameters.length;
  maxValues = maxValues || new Array(parLen).fill(Number.MAX_SAFE_INTEGER);
  minValues = minValues || new Array(parLen).fill(Number.MIN_SAFE_INTEGER);

  if (maxValues.length !== minValues.length) {
    throw new Error('minValues and maxValues must be the same size');
  }

  if (!isArray__default['default'](parameters)) {
    throw new Error('initialValues must be an array');
  }

  if (typeof gradientDifference === 'number') {
    gradientDifference = new Array(parameters.length).fill(gradientDifference);
  } else if (isArray__default['default'](gradientDifference)) {
    if (gradientDifference.length !== parLen) {
      gradientDifference = new Array(parLen).fill(gradientDifference[0]);
    }
  } else {
    throw new Error(
      'gradientDifference should be a number or array with length equal to the number of parameters',
    );
  }

  let filler;
  if (typeof weights === 'number') {
    let value = 1 / Math.pow(weights, 2);
    filler = () => value;
  } else if (isArray__default['default'](weights)) {
    if (weights.length < data.x.length) {
      let value = 1 / Math.pow(weights[0], 2);
      filler = () => value;
    } else {
      filler = (i) => 1 / Math.pow(weights[i], 2);
    }
  } else {
    throw new Error(
      'weights should be a number or array with length equal to the number of data points',
    );
  }

  let checkTimeout;
  if (timeout !== undefined) {
    if (typeof timeout !== 'number') {
      throw new Error('timeout should be a number');
    }
    let endTime = Date.now() + timeout * 1000;
    checkTimeout = () => Date.now() > endTime;
  } else {
    checkTimeout = () => false;
  }

  let weightSquare = new Array(data.x.length);
  for (let i = 0; i < nbPoints; i++) {
    weightSquare[i] = filler(i);
  }

  return {
    checkTimeout,
    minValues,
    maxValues,
    parameters,
    weightSquare,
    damping,
    dampingStepUp,
    dampingStepDown,
    maxIterations,
    errorTolerance,
    centralDifference,
    gradientDifference,
    improvementThreshold,
  };
}

/**
 * the sum of the weighted squares of the errors (or weighted residuals) between the data.y
 * and the curve-fit function.
 * @ignore
 * @param {{x:Array<number>, y:Array<number>}} data - Array of points to fit in the format [x1, x2, ... ], [y1, y2, ... ]
 * @param {Array<number>} parameters - Array of current parameter values
 * @param {function} parameterizedFunction - The parameters and returns a function with the independent variable as a parameter
 * @param {Array} weightSquare - Square of weights
 * @return {number}
 */
function errorCalculation(
  data,
  parameters,
  parameterizedFunction,
  weightSquare,
) {
  let error = 0;
  const func = parameterizedFunction(parameters);
  for (let i = 0; i < data.x.length; i++) {
    error += Math.pow(data.y[i] - func(data.x[i]), 2) / weightSquare[i];
  }

  return error;
}

/**
 * Difference of the matrix function over the parameters
 * @ignore
 * @param {{x:Array<number>, y:Array<number>}} data - Array of points to fit in the format [x1, x2, ... ], [y1, y2, ... ]
 * @param {Array<number>} evaluatedData - Array of previous evaluated function values
 * @param {Array<number>} params - Array of previous parameter values
 * @param {number|array} gradientDifference - The step size to approximate the jacobian matrix
 * @param {boolean} centralDifference - If true the jacobian matrix is approximated by central differences otherwise by forward differences
 * @param {function} paramFunction - The parameters and returns a function with the independent variable as a parameter
 * @return {Matrix}
 */

function gradientFunction(
  data,
  evaluatedData,
  params,
  gradientDifference,
  paramFunction,
  centralDifference,
) {
  const nbParams = params.length;
  const nbPoints = data.x.length;
  let ans = mlMatrix.Matrix.zeros(nbParams, nbPoints);

  let rowIndex = 0;
  for (let param = 0; param < nbParams; param++) {
    if (gradientDifference[param] === 0) continue;
    let delta = gradientDifference[param];
    let auxParams = params.slice();
    auxParams[param] += delta;
    let funcParam = paramFunction(auxParams);
    if (!centralDifference) {
      for (let point = 0; point < nbPoints; point++) {
        ans.set(
          rowIndex,
          point,
          (evaluatedData[point] - funcParam(data.x[point])) / delta,
        );
      }
    } else {
      auxParams = params.slice();
      auxParams[param] -= delta;
      delta *= 2;
      let funcParam2 = paramFunction(auxParams);
      for (let point = 0; point < nbPoints; point++) {
        ans.set(
          rowIndex,
          point,
          (funcParam2(data.x[point]) - funcParam(data.x[point])) / delta,
        );
      }
    }
    rowIndex++;
  }

  return ans;
}

/**
 * Matrix function over the samples
 * @ignore
 * @param {{x:Array<number>, y:Array<number>}} data - Array of points to fit in the format [x1, x2, ... ], [y1, y2, ... ]
 * @param {Array<number>} evaluatedData - Array of previous evaluated function values
 * @return {Matrix}
 */
function matrixFunction(data, evaluatedData) {
  const m = data.x.length;

  let ans = new mlMatrix.Matrix(m, 1);

  for (let point = 0; point < m; point++) {
    ans.set(point, 0, data.y[point] - evaluatedData[point]);
  }
  return ans;
}

/**
 * Iteration for Levenberg-Marquardt
 * @ignore
 * @param {{x:Array<number>, y:Array<number>}} data - Array of points to fit in the format [x1, x2, ... ], [y1, y2, ... ]
 * @param {Array<number>} params - Array of previous parameter values
 * @param {number} damping - Levenberg-Marquardt parameter
 * @param {number|array} gradientDifference - The step size to approximate the jacobian matrix
 * @param {boolean} centralDifference - If true the jacobian matrix is approximated by central differences otherwise by forward differences
 * @param {function} parameterizedFunction - The parameters and returns a function with the independent variable as a parameter
 * @return {Array<number>}
 */
function step(
  data,
  params,
  damping,
  gradientDifference,
  parameterizedFunction,
  centralDifference,
  weights,
) {
  let value = damping;
  let identity = mlMatrix.Matrix.eye(params.length, params.length, value);

  const func = parameterizedFunction(params);

  let evaluatedData = new Float64Array(data.x.length);
  for (let i = 0; i < data.x.length; i++) {
    evaluatedData[i] = func(data.x[i]);
  }

  let gradientFunc = gradientFunction(
    data,
    evaluatedData,
    params,
    gradientDifference,
    parameterizedFunction,
    centralDifference,
  );
  let residualError = matrixFunction(data, evaluatedData);

  let inverseMatrix = mlMatrix.inverse(
    identity.add(
      gradientFunc.mmul(
        gradientFunc.transpose().scale('row', { scale: weights }),
      ),
    ),
  );

  let jacobianWeigthResidualError = gradientFunc.mmul(
    residualError.scale('row', { scale: weights }),
  );

  let perturbations = inverseMatrix.mmul(jacobianWeigthResidualError);

  return {
    perturbations,
    jacobianWeigthResidualError,
  };
}

/**
 * Curve fitting algorithm
 * @param {{x:Array<number>, y:Array<number>}} data - Array of points to fit in the format [x1, x2, ... ], [y1, y2, ... ]
 * @param {function} parameterizedFunction - The parameters and returns a function with the independent variable as a parameter
 * @param {object} [options] - Options object
 * @param {number|array} [options.weights = 1] - weighting vector, if the length does not match with the number of data points, the vector is reconstructed with first value.
 * @param {number} [options.damping = 1e-2] - Levenberg-Marquardt parameter, small values of the damping parameter λ result in a Gauss-Newton update and large
values of λ result in a gradient descent update
 * @param {number} [options.dampingStepDown = 9] - factor to reduce the damping (Levenberg-Marquardt parameter) when there is not an improvement when updating parameters.
 * @param {number} [options.dampingStepUp = 11] - factor to increase the damping (Levenberg-Marquardt parameter) when there is an improvement when updating parameters.
 * @param {number} [options.improvementThreshold = 1e-3] - the threshold to define an improvement through an update of parameters
 * @param {number|array} [options.gradientDifference = 10e-2] - The step size to approximate the jacobian matrix
 * @param {boolean} [options.centralDifference = false] - If true the jacobian matrix is approximated by central differences otherwise by forward differences
 * @param {Array<number>} [options.minValues] - Minimum allowed values for parameters
 * @param {Array<number>} [options.maxValues] - Maximum allowed values for parameters
 * @param {Array<number>} [options.initialValues] - Array of initial parameter values
 * @param {number} [options.maxIterations = 100] - Maximum of allowed iterations
 * @param {number} [options.errorTolerance = 10e-3] - Minimum uncertainty allowed for each point.
 * @param {number} [options.timeout] - maximum time running before throw in seconds.
 * @return {{parameterValues: Array<number>, parameterError: number, iterations: number}}
 */
function levenbergMarquardt(
  data,
  parameterizedFunction,
  options = {},
) {
  let {
    checkTimeout,
    minValues,
    maxValues,
    parameters,
    weightSquare,
    damping,
    dampingStepUp,
    dampingStepDown,
    maxIterations,
    errorTolerance,
    centralDifference,
    gradientDifference,
    improvementThreshold,
  } = checkOptions(data, parameterizedFunction, options);

  let error = errorCalculation(
    data,
    parameters,
    parameterizedFunction,
    weightSquare,
  );

  let converged = error <= errorTolerance;

  let iteration = 0;
  for (; iteration < maxIterations && !converged; iteration++) {
    let previousError = error;

    let { perturbations, jacobianWeigthResidualError } = step(
      data,
      parameters,
      damping,
      gradientDifference,
      parameterizedFunction,
      centralDifference,
      weightSquare,
    );

    for (let k = 0; k < parameters.length; k++) {
      parameters[k] = Math.min(
        Math.max(minValues[k], parameters[k] - perturbations.get(k, 0)),
        maxValues[k],
      );
    }

    error = errorCalculation(
      data,
      parameters,
      parameterizedFunction,
      weightSquare,
    );

    if (isNaN(error)) break;

    let improvementMetric =
      (previousError - error) /
      perturbations
        .transpose()
        .mmul(perturbations.mulS(damping).add(jacobianWeigthResidualError))
        .get(0, 0);

    if (improvementMetric > improvementThreshold) {
      damping = Math.max(damping / dampingStepDown, 1e-7);
    } else {
      error = previousError;
      damping = Math.min(damping * dampingStepUp, 1e7);
    }

    if (checkTimeout()) {
      throw new Error(
        `The execution time is over to ${options.timeout} seconds`,
      );
    }

    converged = error <= errorTolerance;
  }

  return {
    parameterValues: parameters,
    parameterError: error,
    iterations: iteration,
  };
}

module.exports = levenbergMarquardt;
