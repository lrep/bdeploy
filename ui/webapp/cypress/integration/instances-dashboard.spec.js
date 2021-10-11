//@ts-check

describe('Instance Dashboard Tests', () => {
  var groupName = 'Demo';
  var instanceName = 'TestInstance';

  before(() => {
    cy.cleanAllGroups();
  });

  beforeEach(() => {
    cy.login();
  });

  it('Prepares the test (group, products, instance)', () => {
    cy.visit('/');
    cy.createGroup(groupName);
    cy.uploadProductIntoGroup(groupName, 'test-product-2-direct.zip');
    cy.createInstance(groupName, instanceName, 'Demo Product', '2.0.0');
  });

  it('Prepares Instance Version', () => {
    cy.enterInstance(groupName, instanceName);
    cy.pressMainNavButton('Instance Configuration');

    cy.waitUntilContentLoaded();

    // create some from a template
    cy.inMainNavContent(() => {
      cy.contains('.bd-rect-card', 'The instance is currently empty').within(() => {
        cy.get('button[data-cy^="Apply Instance Template"]').click();
      });
    });

    cy.waitUntilContentLoaded();

    cy.inMainNavFlyin('app-instance-templates', () => {
      cy.contains('tr', 'Default Configuration')
        .should('exist')
        .within(() => {
          cy.get('button').click();
        });

      cy.contains('app-bd-notification-card', 'Assign Template').within(() => {
        cy.fillFormSelect('Server Apps', 'Apply to master');
        cy.fillFormSelect('Client Apps', 'Apply to Client Applications');

        cy.get('button[data-cy="Confirm"]').click();
      });

      cy.contains('app-bd-notification-card', 'Assign Variable Values').within(() => {
        cy.fillFormInput('Text Value', 'Test');
        cy.fillFormInput('Sleep Timeout', '5');

        cy.get('button[data-cy="Confirm"]').click();
      });
    });

    cy.inMainNavContent(() => {
      cy.waitForApi(() => {
        cy.pressToolbarButton('Save');
      });

      cy.waitUntilContentLoaded();
    });
  });

  it('Test Dashboard', () => {
    cy.enterInstance(groupName, instanceName);
    cy.pressMainNavButton('Instance Dashboard');

    cy.waitUntilContentLoaded();

    cy.inMainNavContent(() => {
      cy.contains('.bd-rect-card', 'has no active version')
        .should('exist')
        .within(() => {
          cy.waitForApi(() => {
            cy.get('button[data-cy="Install"]').should('be.enabled').click();
          });

          cy.waitForApi(() => {
            cy.get('button[data-cy="Activate"]').should('be.enabled').click();
          });
        });
    });

    cy.contains('app-instance-server-node', 'master')
      .should('exist')
      .within(() => {
        cy.contains('tr', 'Server No Sleep').should('exist');
        cy.contains('tr', 'Server With Sleep').should('exist');
      });

    cy.get('app-instance-client-node')
      .should('exist')
      .within(() => {
        // TODO: find a way to check the current OS in cypress and select the *correct* client app which
        // has an installer available even on CI machines (which only build for their own OS).
        // cy.get('button[data-cy="Installer"]').downloadByLocationAssign('dashboard-installer.bin');
        cy.get('button[data-cy^="Click"]').downloadByLinkClick('dashboard-click-start.json');
      });
  });

  it('Test Process Control', () => {
    cy.inMainNavContent(() => {
      cy.contains('tr', 'Another Server With Sleep').click();
    });

    cy.inMainNavFlyin('app-process-status', () => {
      cy.get('button[data-cy="Process Port Status"]').click();
    });

    cy.inMainNavFlyin('app-process-ports', () => {
      cy.contains('No server ports').should('exist');
      cy.pressToolbarButton('Back to Overview');
    });

    cy.inMainNavFlyin('app-process-status', () => {
      cy.contains('button', 'play_arrow').click();
      cy.contains('button', 'stop').should('be.enabled');

      // first start
      cy.contains('Up Time').should('exist');
      cy.contains('Started At').should('exist');
      cy.contains('button', 'play_arrow').should('be.disabled');

      // crash back off after second start
      cy.contains('Stopped At').should('exist');
      cy.contains('Restart In').should('exist');
      cy.contains('button', 'play_arrow').should('be.enabled');
      cy.contains('button', 'stop').should('be.enabled');

      // permanent crash
      cy.contains('button', 'stop').should('be.disabled');
      cy.contains('button', 'play_arrow').should('be.enabled');
      cy.contains('Stopped At').should('exist');
    });

    cy.inMainNavContent(() => {
      cy.contains('tr', 'Another Server With Sleep').within(() => {
        cy.contains('mat-icon', 'error').should('exist');
      });
    });

    cy.inMainNavFlyin('app-process-status', () => {
      cy.get('button[data-cy="Process Console"]').click();
      cy.pressToolbarButton('Back to Overview');
    });
  });

  it('Tests card mode', () => {
    cy.inMainNavContent(() => {
      cy.pressToolbarButton('Toggle Card Mode');

      cy.contains('app-instance-server-node', 'master').within(() => {
        cy.contains('mat-card', 'Server No Sleep').should('exist');
        cy.contains('mat-card', 'Server With Sleep').should('exist');
      });
    });
  });

  it('Tests collapsed mode', () => {
    cy.inMainNavContent(() => {
      cy.pressToolbarButton('Collapsed Mode');

      cy.contains('app-instance-server-node', 'master').within(() => {
        cy.contains('mat-card', 'Server No Sleep').should('not.exist');
        cy.contains('tr', 'Server No Sleep').should('not.exist');
      });
    });
  });

  it('Tests node details', () => {
    cy.inMainNavContent(() => {
      cy.contains('app-instance-server-node', 'master').within(() => {
        cy.get('button[data-cy="Details"]').click();
      });
    });

    cy.inMainNavFlyin('app-node-details', () => {
      cy.contains('app-bd-notification-card', 'master').should('exist');
      cy.get('app-node-header[show="load"]').should('exist');
      cy.get('app-node-header[show="cpu"]').should('exist');
    });
  });

  it('Cleans up', () => {
    cy.deleteGroup(groupName);
  });
});
