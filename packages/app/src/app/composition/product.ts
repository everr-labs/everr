import { createProduct, type Product } from "@/product/module";
import { productPolicy } from "../policy";

export const product: Product = createProduct(productPolicy);
