// The report function for the browser. The "default" condition of the
// "#report" subpath in package.json selects this module. It only forwards the
// export of the errors module. Thus the react entry and the index entry use
// the same module instance, and the error filter and the rate limit have one
// state.
export { report } from "./errors.js";
