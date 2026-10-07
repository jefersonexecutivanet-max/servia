import orderApi from "../../server/order-api.js";
export default (request, response) => orderApi("createOrder", request, response);