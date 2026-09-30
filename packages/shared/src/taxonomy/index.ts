export type {
  CatalogTaxonomyFacet,
  CatalogTaxonomyListData,
  LanguageCode,
  LocalizedText,
  LocalizedTextMap,
  SourceReference,
  TaxonomyOrigin,
  TaxonomyReference,
} from './taxonomy.ts';
export {
  catalogTaxonomyFacetSchema,
  catalogTaxonomyListDataSchema,
  LANGUAGE_CODES,
  languageCodeSchema,
  localizedTextSchema,
  mergeLocalizedText,
  optionalLocalizedText,
  resolveLocalizedText,
  sourceReferenceSchema,
  TAXONOMY_NAME_MAX,
  TAXONOMY_ORIGINS,
  taxonomyReferenceSchema,
} from './taxonomy.ts';
