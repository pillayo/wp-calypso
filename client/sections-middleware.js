/** @format */
/**
 * External dependencies
 */
import config from 'config';
import page from 'page';

/**
 * Internal dependencies
 */
import { activateNextLayoutFocus } from 'state/ui/layout-focus/actions';
import { bumpStat } from 'state/analytics/actions';
import * as LoadingError from 'layout/error';
import * as controller from './controller/index.web';
import { pathToRegExp } from './utils';
import { receiveSections, preload } from './sections-helper';

import sections from './sections';
receiveSections( sections );

const _loadedSections = {};

function activateSection( sectionDefinition, context, next ) {
	const dispatch = context.store.dispatch;

	controller.setSection( sectionDefinition )( context );
	dispatch( { type: 'SECTION_SET', isLoading: false } );
	dispatch( activateNextLayoutFocus() );
	next();
}

function createPageDefinition( path, sectionDefinition ) {
	const pathRegex = pathToRegExp( path );

	page( pathRegex, function( context, next ) {
		const envId = sectionDefinition.envId;
		const dispatch = context.store.dispatch;

		if ( envId && envId.indexOf( config( 'env_id' ) ) === -1 ) {
			return next();
		}

		console.log('pagehandler called:', pathRegex, sectionDefinition.module);
		if ( _loadedSections[ sectionDefinition.module ] ) {
			console.log('returning already activated section', sectionDefinition.module);
			return activateSection( sectionDefinition, context, next );
		}
		dispatch( { type: 'SECTION_SET', isLoading: true } );

		// If the section chunk is not loaded within 400ms, report it to analytics
		const loadReportTimeout = setTimeout(
			() => dispatch( bumpStat( 'calypso_chunk_waiting', sectionDefinition.name ) ),
			400
		);
		
		console.log('gonna preload', sectionDefinition.name, sectionDefinition.module);
		preload( sectionDefinition.name )
			.then( requiredModules => {
				console.log('done preloading', sectionDefinition.module);
				if ( ! _loadedSections[ sectionDefinition.module ] ) {
					console.log('going to init modules:', sectionDefinition.module, requiredModules.length);
					requiredModules.forEach( mod => mod.default( controller.clientRouter ) );
					console.log('init loop done');
					_loadedSections[ sectionDefinition.module ] = true;
				}
				return activateSection( sectionDefinition, context, next );
			} )
			.catch( error => {
				console.log( 'caught error while preloading', sectionDefinition.module);
				console.error( error ); // eslint-disable-line
				if ( ! LoadingError.isRetry() && process.env.NODE_ENV !== 'development' ) {
					LoadingError.retry( sectionDefinition.name );
				} else {
					dispatch( { type: 'SECTION_SET', isLoading: false } );
					LoadingError.show( context, sectionDefinition.name );
				}
			} )
			.then( () => {
				// If the load was faster than the timeout, this will cancel the analytics reporting
				clearTimeout( loadReportTimeout );
			} );
	} );
}

export const setupRoutes = () => {
	sections.forEach( section =>
		section.paths.forEach( path => createPageDefinition( path, section ) )
	);
};
