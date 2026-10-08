import cashApi from "../../server/cash-api.js";
export default (request, response) => cashApi("close", request, response);
