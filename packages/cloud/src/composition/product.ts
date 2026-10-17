import type { Product } from "@everr/app/composition";
import { createProduct } from "@everr/app/product/module";
import { productPolicy } from "../app/policy";

export const product: Product = createProduct(productPolicy);
