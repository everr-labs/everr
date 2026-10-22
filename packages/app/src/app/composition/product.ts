import { createProduct, type Product } from "#app/product/module.ts";
import { productPolicy } from "../policy";

export const product: Product = createProduct(productPolicy);
