
var os = require('os'),
    AWS = require('aws-sdk');


AWS.config = new AWS.Config({
  region: process.env.AWS_REGION || 'us-east-1'
});


var lambda = new AWS.Lambda();
var swfClient = new AWS.SimpleWorkflow();


var config = {
   "domain": process.env.DOMAIN || "testdomain",
   "taskList": {"name": process.env.TASKLIST || "testtasklist"},
   "identity": 'Decider-' + os.hostname() + '-' + process.pid,
   "maximumPageSize": 100,
   "reverseOrder": false // IMPORTANT: must replay events in the right order, ie. from the start
};



var stop_poller = false;


var _ = {
  clone: function (src) {
    var tgt = {}, k;
    for (k in src) {
       if (src.hasOwnProperty(k)) {
          tgt[k] = src[k];
       }
    }
    return tgt;
  }
};


var poll = function () {


   // Copy config
   var o = _.clone(config);

   console.log("polling...");

   // Poll request on AWS
   // http://docs.aws.amazon.com/amazonswf/latest/apireference/API_PollForDecisionTask.html
   swfClient.pollForDecisionTask(o, function (err, result) {

      if (err) {
        console.log("Error in polling ! ", err);
        poll();
        return;
      }

      // If no new task, re-poll
      if (!result.taskToken) {
         poll();
         return;
      }

      _onNewTask(result);
      poll();
   });

};


var _onNewTask = function(originalResult,result, events) {
    //For the first call, events will not be passed.
    events = events || [];
    result = result || originalResult;
    events.push.apply(events,result.events);
    //If more pages are available, make call to fetch objects
    if(result.nextPageToken) {
        var pollConfig = _.clone(config);
        pollConfig.nextPageToken = result.nextPageToken;
        swfClient.pollForDecisionTask(pollConfig, function (err, nextPageResult) {
            if (err) {
                console.log('error', err);
                return;
            }
            _onNewTask(originalResult, nextPageResult, events);

        });
    } else {
        // No more pages available. Create decisionTask.
        console.log(JSON.stringify(originalResult, null, 3));

        var workflowType = originalResult.workflowType;
        var workflowName = workflowType.name;
        var workflowVersion = workflowType.version;
        console.log('New Decision Task received !', workflowName, workflowVersion);

        var workflowLambdaName = (workflowName+'-'+workflowVersion).replace(/[^a-zA-Z0-9\-\_]/g, '_'); //letters, numbers, hyphens, or underscores
        console.log('Delegating decision to lambda: '+workflowLambdaName);

        var params = {
          FunctionName: workflowLambdaName,
          InvocationType: 'Event', // Do not wait for execution
          LogType: 'None',
          Payload: JSON.stringify(originalResult)
        };
        console.log('Invoking lambda', params);
        lambda.invoke(params, function(err, data) {
          if (err) console.log(err, err.stack); // an error occurred
          else     console.log(data);           // successful response
        });

    }

};


poll();
