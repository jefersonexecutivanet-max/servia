import cashApi from "../../server/cash-api.js";
export default (request, response) => cashApi("open", request, response);
