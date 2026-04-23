import type { Schema, Struct } from '@strapi/strapi';

export interface ProductPlantMetadata extends Struct.ComponentSchema {
  collectionName: 'components_product_plant_metadata';
  info: {
    displayName: 'plant-metadata';
  };
  attributes: {
    care_tips: Schema.Attribute.Text;
    difficulty: Schema.Attribute.String;
    dimensions: Schema.Attribute.String;
    growth: Schema.Attribute.String;
    humidity: Schema.Attribute.String;
    light: Schema.Attribute.String;
    material: Schema.Attribute.String;
    origin: Schema.Attribute.String;
    pet_friendly: Schema.Attribute.Boolean;
    propagation: Schema.Attribute.String;
    scientificName: Schema.Attribute.String;
    substratum: Schema.Attribute.String;
    temperature: Schema.Attribute.String;
    type_plant: Schema.Attribute.String;
    water: Schema.Attribute.String;
  };
}

export interface ProductVariant extends Struct.ComponentSchema {
  collectionName: 'components_product_variants';
  info: {
    displayName: 'variant';
  };
  attributes: {
    color: Schema.Attribute.String;
    image: Schema.Attribute.String;
    stock: Schema.Attribute.Integer;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'product.plant-metadata': ProductPlantMetadata;
      'product.variant': ProductVariant;
    }
  }
}
